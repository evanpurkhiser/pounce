import {createCollection, localOnlyCollectionOptions} from '@tanstack/db';
import {QueryClient} from '@tanstack/react-query';

import {
  inRange,
  isSplitOrGrouped,
  listTransactions,
  monthRange,
  type DataSource,
  type Range,
  type Row,
  type TransactionPage,
  type Update,
} from './api';
import {
  editUpdate,
  message,
  equal,
  patchKeys,
  pickFields,
  resolvePatch,
  tagChanges,
  type Edit,
  type EditKind,
  type WriteReceipt,
} from './editChanges';
import {createEditQueue} from './editQueue';

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

  async function send(updates: PreparedUpdate[], receipt: WriteReceipt) {
    // Lunch Money requires individual writes for split and grouped rows.
    const batches = Map.groupBy(updates, ({id, original}, index) =>
      isSplitOrGrouped(original) ? id : `bulk:${Math.floor(index / 500)}`,
    );

    for (const batch of batches.values()) {
      try {
        const confirmed = await source.update(
          batch.map(({id, patch, addTags}) => ({id, patch, addTags})),
        );
        const byId = new Map(confirmed.map(row => [row.id, row]));
        for (const {id, original, patch, addTags} of batch) {
          const row = byId.get(id);
          if (!row) {
            receipt.issues.push(`Missing write confirmation for #${id}.`);
            continue;
          }

          mergeRow(row);
          const requested = patchKeys(patch);
          const saved = requested.filter(key =>
            key === 'tag_ids' && addTags
              ? addTags.every(tag => row.tag_ids.includes(tag))
              : equal(key, row[key], patch[key]),
          );
          if (saved.length !== requested.length) {
            receipt.issues.push(`#${id} returned a different value from Lunch Money.`);
          }
          if (saved.length) {
            const before = pickFields(original, saved);
            if (addTags && saved.includes('tag_ids')) {
              before.tag_ids = row.tag_ids.filter(tag => !addTags.includes(tag));
            }
            receipt.written.push({id, before, after: pickFields(row, saved)});
          }
        }
      } catch (error) {
        receipt.issues.push(
          `${batch.map(({id}) => `#${id}`).join(', ')} · ${message(error)}`,
        );
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

  function persist(edit: Edit, kind: EditKind) {
    return withWrite(async () => {
      const updates = edit.changes.map(change => editUpdate(change, kind));
      const refreshIds = updates
        .filter(({patch}) => kind !== 'save' || patch.tag_ids !== undefined)
        .map(({id}) => id);
      for (const row of await getCurrent(refreshIds)) {
        mergeRow(row);
      }

      const receipt: WriteReceipt = {
        written: [],
        alreadySatisfied: new Map(),
        issues: [],
      };
      const prepared: PreparedUpdate[] = [];
      for (const update of updates) {
        const {id, expected} = update;
        const original = rows.get(id);
        if (!original) {
          receipt.issues.push(`Transaction #${id} is unavailable.`);
          continue;
        }

        const desired = resolvePatch(update, original);
        const fields = patchKeys(desired);
        const changed = fields.filter(key => !equal(key, original[key], desired[key]));
        const satisfied = fields.filter(key => !changed.includes(key));
        if (satisfied.length) {
          receipt.alreadySatisfied.set(id, satisfied);
        }
        if (kind !== 'save') {
          const conflicts = changed.filter(
            key => key !== 'tag_ids' && !equal(key, original[key], expected[key]),
          );
          if (conflicts.length) {
            receipt.issues.push(
              `Transaction #${id} changed in Lunch Money (${conflicts.join(', ')}).`,
            );
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

  function refreshRows(ids: number[]) {
    return withWrite(async () => {
      for (const row of await getCurrent(ids)) {
        mergeRow(row);
      }
    });
  }

  const edits = createEditQueue({persist, refreshRows});
  return {source, query, rows, loadPage, applyPages, edits};
}

export type Session = ReturnType<typeof createSession>;
export {message} from './editChanges';
