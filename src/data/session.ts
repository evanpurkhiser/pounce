import {
  createCollection,
  createTransaction,
  localOnlyCollectionOptions,
} from '@tanstack/db';
import {QueryClient} from '@tanstack/react-query';

import {
  inRange,
  isSplitOrGrouped,
  listTransactions,
  monthRange,
  type DataSource,
  type Patch,
  type Range,
  type Row,
  type TransactionPage,
  type Update,
} from './api';

type Change = {id: number; before: Patch; after: Patch};
export type Edit = {label: string; changes: Change[]};
export type WriteResult = {edit: Edit; issues: string[]};
type EditableKey = keyof Patch;
type SessionPage = TransactionPage & {writeVersion: number; readVersion: number};

function equal(key: EditableKey, left: unknown, right: unknown) {
  if (key === 'tag_ids') {
    const a = new Set(left as number[]);
    const b = new Set(right as number[]);
    return a.size === b.size && [...a].every(id => b.has(id));
  }
  return key === 'notes' ? (left ?? '') === (right ?? '') : left === right;
}

function patchValues(row: Row, fields: EditableKey[]): Patch {
  return Object.fromEntries(
    fields.map(key => [key, row[key] ?? (key === 'notes' ? '' : null)]),
  );
}

function patchKeys(patch: Patch) {
  return Object.keys(patch) as EditableKey[];
}

function tagChanges(before: number[], after: number[]) {
  return {
    added: after.filter(id => !before.includes(id)),
    removed: before.filter(id => !after.includes(id)),
  };
}

function applyTagChanges(current: number[], added: number[], removed: number[]) {
  return [...new Set([...current.filter(id => !removed.includes(id)), ...added])];
}

export type QueuedUpdate = Update & {tags?: ReturnType<typeof tagChanges>};

export function queueUpdate(row: Row, patch: Patch): QueuedUpdate | undefined {
  if (patchKeys(patch).every(key => equal(key, row[key], patch[key]))) {
    return;
  }

  return {
    id: row.id,
    patch,
    tags: patch.tag_ids && tagChanges(row.tag_ids, patch.tag_ids),
  };
}

export function resolveUpdate(update: QueuedUpdate, row: Row): Patch {
  const {patch, tags} = update;
  return tags
    ? {...patch, tag_ids: applyTagChanges(row.tag_ids, tags.added, tags.removed)}
    : patch;
}

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
    if (rows.has(row.id)) {
      rows.update(row.id, draft => {
        Object.assign(draft, row);
      });
    } else {
      rows.insert(row);
    }
  }

  async function getCurrent(ids: number[]) {
    const result = new Map<number, Row>();
    if (ids.length > 16) {
      const months = new Set(
        ids.flatMap(id => {
          const date = rows.get(id)?.date;
          return date ? [date.slice(0, 7)] : [];
        }),
      );
      for (const month of months) {
        for (const row of await listTransactions(source, monthRange(month))) {
          result.set(row.id, row);
        }
      }
    }
    const missing = ids.filter(id => !result.has(id));
    for (let index = 0; index < missing.length; index += 16) {
      const fetched = await Promise.all(
        missing.slice(index, index + 16).map(id => source.get(id)),
      );
      for (const row of fetched) {
        result.set(row.id, row);
      }
    }
    return ids.map(id => result.get(id)!);
  }

  async function mutate(label: string, changes: Update[]): Promise<WriteResult> {
    const issues: string[] = [];
    const committed: Change[] = [];
    const patches = new Map(changes.map(change => [change.id, change.patch]));
    const tx = createTransaction({
      autoCommit: false,
      mutationFn: async ({transaction}) => {
        const originals = new Map(
          transaction.mutations.map(mutation => [Number(mutation.key), mutation]),
        );
        // The bulk endpoint documents restrictions on split and grouped rows.
        const batches = Map.groupBy(changes, ({id}, index) => {
          const original = originals.get(id)?.original as Row;
          return isSplitOrGrouped(original) ? id : `bulk:${Math.floor(index / 500)}`;
        });

        for (const batch of batches.values()) {
          try {
            const sent = batch.map(item => {
              const original = originals.get(item.id)?.original as Row;
              const delta =
                item.patch.tag_ids && tagChanges(original.tag_ids, item.patch.tag_ids);
              return {
                ...item,
                addTags: delta && !delta.removed.length ? delta.added : undefined,
              };
            });
            const addOnly = new Map(
              sent.flatMap(item =>
                item.addTags ? [[item.id, item.addTags] as const] : [],
              ),
            );
            const confirmed = await source.update(sent);
            for (const row of confirmed) {
              const mutation = originals.get(row.id);
              const patch = patches.get(row.id);
              if (!mutation || !patch) {
                continue;
              }
              const requested = patchKeys(patch);
              const added = addOnly.get(row.id);
              const saved = requested.filter(key =>
                key === 'tag_ids' && added
                  ? added.every(tag => row.tag_ids.includes(tag))
                  : equal(key, row[key], patch[key]),
              );
              if (saved.length !== requested.length) {
                issues.push(
                  '#' + row.id + ' returned a different value from Lunch Money.',
                );
              }
              if (saved.length) {
                const before = patchValues(mutation.original as Row, saved);
                if (added && saved.includes('tag_ids')) {
                  before.tag_ids = row.tag_ids.filter(tag => !added.includes(tag));
                }
                committed.push({id: row.id, before, after: patchValues(row, saved)});
              }
              rows.utils.acceptMutations({
                mutations: [{...mutation, modified: {...mutation.modified, ...row}}],
              });
            }
            const returned = new Set(confirmed.map(row => row.id));
            const missing = batch.filter(change => !returned.has(change.id));
            if (missing.length) {
              issues.push(
                'Missing write confirmation for ' +
                  missing.map(change => '#' + change.id).join(', '),
              );
            }
          } catch (error) {
            issues.push(
              `${batch.map(change => '#' + change.id).join(', ')} · ${message(error)}`,
            );
          }
          if (issues.length) {
            break;
          }
        }

        if (!committed.length && issues.length) {
          throw new Error(issues.join('\n'));
        }
      },
    });
    tx.mutate(() => {
      for (const {id, patch} of changes) {
        rows.update(id, row => {
          Object.assign(row, patch);
        });
      }
    });
    await tx.commit();
    return {edit: {label, changes: committed}, issues};
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

  function write(
    label: string,
    getUpdates: () => QueuedUpdate[] | Promise<QueuedUpdate[]>,
  ) {
    return withWrite(async () => {
      const requested = await getUpdates();
      const requestedTags = requested.filter(({patch}) => patch.tag_ids !== undefined);
      const freshTags = await getCurrent(requestedTags.map(({id}) => id));
      const currentTags = new Map(freshTags.map(row => [row.id, row]));
      const updates = requested
        .map(update => {
          const {id, patch} = update;
          const current = currentTags.get(id);
          const previous = rows.get(id);
          if (!current || !previous || patch.tag_ids === undefined) {
            return {id, patch};
          }
          const tags = update.tags ?? tagChanges(previous.tag_ids, patch.tag_ids);
          mergeRow(current);
          return {id, patch: resolveUpdate({...update, tags}, current)};
        })
        .filter(({id, patch}) => {
          const row = rows.get(id);
          return row && patchKeys(patch).some(key => !equal(key, row[key], patch[key]));
        });
      return updates.length
        ? await mutate(label, updates)
        : {edit: {label, changes: []}, issues: []};
    });
  }

  function refreshRows(ids: number[]) {
    return withWrite(async () => {
      for (const row of await getCurrent(ids)) {
        mergeRow(row);
      }
    });
  }

  function replay(edit: Edit, direction: 'undo' | 'redo') {
    const from = direction === 'undo' ? 'after' : 'before';
    const to = direction === 'undo' ? 'before' : 'after';
    return write(edit.label, async () => {
      const fresh = await getCurrent(edit.changes.map(change => change.id));
      for (const row of fresh) {
        mergeRow(row);
      }

      return edit.changes.map((change, index) => {
        const current = fresh[index];
        const fields = patchKeys(change[to]);
        const conflicts = fields.filter(
          key => key !== 'tag_ids' && !equal(key, current[key], change[from][key]),
        );
        if (conflicts.length) {
          throw new Error(
            'Transaction #' +
              change.id +
              ' changed in Lunch Money (' +
              conflicts.join(', ') +
              ').',
          );
        }
        const patch = {...change[to]};
        if (patch.tag_ids) {
          const {added, removed} = tagChanges(change[from].tag_ids ?? [], patch.tag_ids);
          patch.tag_ids = applyTagChanges(current.tag_ids, added, removed);
        }
        return {id: current.id, patch};
      });
    });
  }

  return {source, query, rows, loadPage, applyPages, write, replay, refreshRows};
}

export type Session = ReturnType<typeof createSession>;
export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
