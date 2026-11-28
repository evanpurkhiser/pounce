import {createCollection, localOnlyCollectionOptions} from '@tanstack/db';
import {QueryClient} from '@tanstack/react-query';

import {
  inRange,
  isSplitOrGrouped,
  listTransactions,
  monthRange,
  type DataSource,
  type GroupRef,
  type Range,
  type Row,
  type TransactionPage,
  type TransactionRef,
  type Update,
} from './api';
import {
  editUpdate,
  equalField,
  patchKeys,
  partitionReplay,
  pickFields,
  resolvePatch,
  tagChanges,
  type Edit,
  type EditKind,
  type WriteIssue,
  type WriteReceipt,
} from './editChanges';
import {createEditQueue, type EditResult, type QueuedEdit} from './editQueue';
import {persistGroupEdit, type GroupEdit} from './transactionGroups';

type SessionPage = TransactionPage & {writeVersion: number; readVersion: number};
type PreparedUpdate = Update & {original: Row; addTags?: number[]};

export function createSession(source: DataSource) {
  const query = new QueryClient({
    defaultOptions: {
      queries: {retry: false, staleTime: 30_000, refetchOnWindowFocus: false},
    },
  });
  const rows = createCollection(
    localOnlyCollectionOptions<Row, number>({getKey: row => row.id}),
  );
  // An in-flight month snapshot must never overwrite a newer local write.
  let writeVersion = 0;
  let nextReadVersion = 0;
  const appliedRanges = new Map<string, Range & {readVersion: number}>();
  let pending: Promise<unknown> | undefined;

  async function loadPage(
    range: Range,
    offset: number,
    signal: AbortSignal,
  ): Promise<SessionPage> {
    for (;;) {
      await pending?.catch(() => {});
      signal.throwIfAborted();
      const version = writeVersion;
      const readVersion = ++nextReadVersion;
      const page = await source.transactionsPage(range, offset, signal);
      signal.throwIfAborted();
      if (version === writeVersion) {
        return {...page, writeVersion: version, readVersion};
      }
    }
  }

  function applyPages(range: Range, pages: SessionPage[]) {
    // A snapshot that began before a local write or a newer overlapping read must be refreshed.
    if (!pages.length || pages.some(page => page.writeVersion !== writeVersion)) {
      return false;
    }

    const readVersion = Math.min(...pages.map(page => page.readVersion));
    for (const applied of appliedRanges.values()) {
      if (
        applied.start <= range.end &&
        range.start <= applied.end &&
        applied.readVersion > readVersion
      ) {
        return false;
      }
    }

    const fresh = new Map(
      pages.flatMap(page => page.rows.map(row => [row.id, row] as const)),
    );
    const removed = [...rows.values()].filter(
      row => inRange(row.date, range) && !fresh.has(row.id),
    );
    if (removed.length) {
      rows.delete(removed.map(row => row.id));
    }
    for (const row of fresh.values()) {
      mergeRow(row);
    }
    for (const [key, applied] of appliedRanges) {
      if (range.start <= applied.start && applied.end <= range.end) {
        appliedRanges.delete(key);
      }
    }
    appliedRanges.set(`${range.start}/${range.end}`, {...range, readVersion});
    return true;
  }

  function mergeRow(row: Row) {
    if (typeof row.group_parent_id === 'number') {
      if (rows.has(row.id)) {
        rows.delete(row.id);
      }
      return;
    }

    if (rows.has(row.id)) {
      rows.update(row.id, draft => {
        Object.assign(draft, row);
      });
    } else {
      rows.insert(row);
    }
  }

  async function reconcile(ids: number[]): Promise<WriteIssue[]> {
    const current = new Map<number, Row>();
    if (ids.length > 16) {
      const months = new Set(
        ids.flatMap(id => {
          const date = rows.get(id)?.date;
          return date ? [date.slice(0, 7)] : [];
        }),
      );
      try {
        for (const month of months) {
          for (const row of await listTransactions(source, monthRange(month))) {
            current.set(row.id, row);
          }
        }
      } catch (error) {
        return [{kind: 'requestFailed', operation: 'read', ids, error}];
      }
    }

    const issues: WriteIssue[] = [];
    const missing = ids.filter(id => !current.has(id));
    for (let index = 0; index < missing.length; index += 16) {
      const batch = missing.slice(index, index + 16);
      const fetched = await Promise.allSettled(batch.map(id => source.get(id)));
      for (const [offset, result] of fetched.entries()) {
        const id = batch[offset];
        if (result.status === 'rejected') {
          issues.push({
            kind: 'requestFailed',
            operation: 'read',
            ids: [id],
            error: result.reason,
          });
        } else if (result.value.id !== id) {
          issues.push({kind: 'unavailable', id});
        } else {
          current.set(id, result.value);
        }
      }
    }

    return [
      ...issues,
      ...ids.flatMap(id => {
        const row = current.get(id);
        return row ? mergeConfirmed(row) : [];
      }),
    ];
  }

  function cacheWriteIssues(id: number, write: () => void): WriteIssue[] {
    try {
      write();
      return [];
    } catch (error) {
      return [{kind: 'cacheUpdateFailed', id, error}];
    }
  }

  function mergeConfirmed(row: Row) {
    return cacheWriteIssues(row.id, () => mergeRow(row));
  }

  async function send(updates: PreparedUpdate[], receipt: WriteReceipt) {
    // Lunch Money requires individual writes for split and grouped rows.
    const batches = Map.groupBy(updates, ({id, original}, index) =>
      isSplitOrGrouped(original) ? id : `bulk:${Math.floor(index / 500)}`,
    );

    for (const batch of batches.values()) {
      let confirmed: Row[];
      try {
        confirmed = await source.update(
          batch.map(({id, patch, addTags}) => ({id, patch, addTags})),
        );
      } catch (error) {
        receipt.issues.push({
          kind: 'requestFailed',
          operation: 'write',
          ids: batch.map(({id}) => id),
          error,
        });
        break;
      }

      const byId = new Map(confirmed.map(row => [row.id, row]));
      for (const {id, original, patch, addTags} of batch) {
        const row = byId.get(id);
        if (!row) {
          receipt.issues.push({kind: 'missingConfirmation', id});
          continue;
        }

        const requested = patchKeys(patch);
        const saved = requested.filter(key =>
          key === 'tag_ids' && addTags
            ? addTags.every(tag => row.tag_ids.includes(tag))
            : equalField(key, row, patch),
        );
        if (saved.length !== requested.length) {
          receipt.issues.push({
            kind: 'differentValue',
            id,
            fields: requested.filter(key => !saved.includes(key)),
          });
        }
        if (saved.length) {
          const before = pickFields(original, saved);
          if (addTags && saved.includes('tag_ids')) {
            before.tag_ids = row.tag_ids.filter(tag => !addTags.includes(tag));
          }
          receipt.written.push({id, before, after: pickFields(row, saved)});
        }
        receipt.issues.push(...mergeConfirmed(row));
      }

      if (receipt.issues.length) {
        break;
      }
    }
  }

  function withWrite<T>(work: () => Promise<T>) {
    if (pending) {
      return Promise.reject(new Error('An edit is still saving.'));
    }
    writeVersion++;
    const operation = work().finally(() => {
      writeVersion++;
      pending = undefined;
      void query.invalidateQueries({queryKey: ['budget']});
      void query.invalidateQueries({queryKey: ['transactions'], refetchType: 'none'});
    });
    pending = operation;
    return operation;
  }

  function writeFields(edit: Edit, kind: EditKind) {
    return withWrite(async () => {
      const updates = edit.changes.map(change => editUpdate(change, kind));
      const refreshIds = updates
        .filter(({patch}) => kind !== 'save' || patch.tag_ids !== undefined)
        .map(({id}) => id);
      const receipt: WriteReceipt = {
        written: [],
        alreadySatisfied: new Map(),
        issues: await reconcile(refreshIds),
      };
      if (receipt.issues.length) {
        return receipt;
      }

      const prepared: PreparedUpdate[] = [];
      for (const update of updates) {
        const {id, expected} = update;
        const original = rows.get(id);
        if (!original) {
          receipt.issues.push({kind: 'unavailable', id});
          continue;
        }

        const desired = resolvePatch(update, original);
        const fields = patchKeys(desired);
        const changed = fields.filter(key => !equalField(key, original, desired));
        const satisfied = fields.filter(key => !changed.includes(key));
        if (satisfied.length) {
          receipt.alreadySatisfied.set(id, satisfied);
        }
        if (kind !== 'save') {
          const conflicts = changed.filter(
            key => key !== 'tag_ids' && !equalField(key, original, expected),
          );
          if (conflicts.length) {
            receipt.issues.push({kind: 'conflict', id, fields: conflicts});
          }
        }
        if (changed.length) {
          const patch = pickFields(desired, changed);
          const tags = patch.tag_ids && tagChanges(original.tag_ids, patch.tag_ids);
          prepared.push({
            id,
            patch,
            original,
            addTags: tags && !tags.removed.length ? tags.added : undefined,
          });
        }
      }

      if (!receipt.issues.length) {
        await send(prepared, receipt);
      }
      return receipt;
    });
  }

  async function persistFields(edit: Edit, kind: EditKind): Promise<EditResult<Edit>> {
    const receipt = await writeFields(edit, kind);
    const {written, issues} = receipt;
    if (kind === 'save') {
      return {
        applied: written.length ? {...edit, changes: written} : undefined,
        savedCount: written.length,
        issues,
      };
    }

    const {moved, remaining} = partitionReplay(edit, receipt);
    return {
      applied: moved.length ? {...edit, changes: moved} : undefined,
      remaining: remaining.length ? {...edit, changes: remaining} : undefined,
      issues,
    };
  }

  function persistGroup(
    edit: GroupEdit,
    kind: EditKind,
    bindings: ReadonlyMap<number, GroupRef>,
  ): Promise<EditResult> {
    return withWrite(async () => {
      const result = await persistGroupEdit(source, edit.group, kind, bindings);
      const issues = [
        ...result.issues,
        ...result.removedParentIds.flatMap(id =>
          rows.has(id) ? cacheWriteIssues(id, () => rows.delete(id)) : [],
        ),
        ...result.rows.flatMap(mergeConfirmed),
      ];

      return {
        applied: result.applied && {...edit, group: result.applied},
        remaining: result.remaining && {...edit, group: result.remaining},
        groupBindings: {removed: result.removedParentIds, confirmed: result.bindings},
        issues,
      };
    });
  }

  function resolveFields(
    edit: Edit<TransactionRef>,
    bindings: ReadonlyMap<number, GroupRef>,
  ) {
    const byRef = new Map([...bindings].map(([id, ref]) => [ref, id]));
    return edit.changes.flatMap(change => {
      const id = typeof change.id === 'number' ? change.id : byRef.get(change.id);
      return id === undefined
        ? []
        : [{id, target: change.id, before: change.before, after: change.after}];
    });
  }

  async function persistTransactionEdit(
    edit: Edit<TransactionRef>,
    kind: EditKind,
    bindings: ReadonlyMap<number, GroupRef>,
  ): Promise<EditResult> {
    const resolved = resolveFields(edit, bindings);
    if (resolved.length !== edit.changes.length) {
      return {issues: [{kind: 'groupUnavailable'}]};
    }

    const changes = resolved.map(({id, before, after}) => ({id, before, after}));
    const targets = new Map(resolved.map(({id, target}) => [id, target]));
    const result = await persistFields({...edit, changes}, kind);
    const retarget = (saved?: Edit) =>
      saved && {
        ...saved,
        changes: saved.changes.map(change => ({
          ...change,
          id: targets.get(change.id) ?? change.id,
        })),
      };
    return {
      ...result,
      applied: retarget(result.applied),
      remaining: retarget(result.remaining),
    };
  }

  const edits = createEditQueue({
    persist: (edit, kind, bindings) =>
      'group' in edit
        ? persistGroup(edit, kind, bindings)
        : persistTransactionEdit(edit, kind, bindings),
    async recover(edit: QueuedEdit, bindings) {
      if ('changes' in edit) {
        return withWrite(() =>
          reconcile(resolveFields(edit, bindings).map(({id}) => id)),
        );
      }

      await query.invalidateQueries({queryKey: ['transactions']});
      return [];
    },
  });
  return {source, query, rows, loadPage, applyPages, edits};
}

export type Session = ReturnType<typeof createSession>;
export {message} from './editChanges';
