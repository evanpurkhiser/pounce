import type {Patch, Row, Update} from './api';

export type Change = {id: number; before: Patch; after: Patch};
export type Edit = {label: string; changes: Change[]};
export type EditKind = 'save' | 'undo' | 'redo';
export type EditableKey = keyof Patch;
export type WriteIssue =
  | {kind: 'unavailable' | 'missingConfirmation'; id: number}
  | {kind: 'conflict' | 'differentValue'; id: number; fields: EditableKey[]}
  | {kind: 'requestFailed'; operation: 'read' | 'write'; ids: number[]; error: unknown}
  | {kind: 'cacheUpdateFailed'; id: number; error: unknown}
  | {kind: 'unexpectedFailure'; error: unknown};

export type WriteReceipt = {
  written: Change[];
  alreadySatisfied: Map<number, EditableKey[]>;
  issues: WriteIssue[];
};

export function equalField(key: EditableKey, left: Row | Patch, right: Row | Patch) {
  if (key === 'notes') {
    return (left.notes ?? '') === (right.notes ?? '');
  }
  if (key !== 'tag_ids') {
    return left[key] === right[key];
  }
  if (!left.tag_ids || !right.tag_ids) {
    return left.tag_ids === right.tag_ids;
  }

  const a = new Set(left.tag_ids);
  const b = new Set(right.tag_ids);
  return a.size === b.size && [...a].every(id => b.has(id));
}

export function patchKeys(patch: Patch) {
  return Object.keys(patch) as EditableKey[];
}

export function pickFields(values: Patch | Row, fields: EditableKey[]): Patch {
  return Object.fromEntries(
    fields.map(key => [key, values[key] ?? (key === 'notes' ? '' : null)]),
  );
}

export function draftChange(row: Row, patch: Patch): Change | undefined {
  const fields = patchKeys(patch).filter(key => !equalField(key, row, patch));
  if (fields.length) {
    return {
      id: row.id,
      before: pickFields(row, fields),
      after: pickFields(patch, fields),
    };
  }
}

export function tagChanges(before: number[], after: number[]) {
  return {
    added: after.filter(id => !before.includes(id)),
    removed: before.filter(id => !after.includes(id)),
  };
}

export type EditUpdate = Update & {expected: Patch};

export function editUpdate(change: Change, kind: EditKind): EditUpdate {
  const {id, before, after} = change;
  return kind === 'undo'
    ? {id, patch: before, expected: after}
    : {id, patch: after, expected: before};
}

export function resolvePatch({patch, expected}: EditUpdate, row: Row): Patch {
  if (!patch.tag_ids) {
    return patch;
  }

  const {added, removed} = tagChanges(expected.tag_ids ?? [], patch.tag_ids);
  return {
    ...patch,
    tag_ids: [...new Set([...row.tag_ids.filter(id => !removed.includes(id)), ...added])],
  };
}

export function partitionReplay(edit: Edit, receipt: WriteReceipt) {
  const accepted = new Map(receipt.alreadySatisfied);
  for (const change of receipt.written) {
    accepted.set(change.id, [
      ...(accepted.get(change.id) ?? []),
      ...patchKeys(change.after),
    ]);
  }

  const moved: Change[] = [];
  const remaining: Change[] = [];
  for (const {id, before, after} of edit.changes) {
    const confirmed = accepted.get(id) ?? [];
    const fields = patchKeys(after);
    const saved = fields.filter(key => confirmed.includes(key));
    const unsaved = fields.filter(key => !confirmed.includes(key));
    if (saved.length) {
      moved.push({
        id,
        before: pickFields(before, saved),
        after: pickFields(after, saved),
      });
    }
    if (unsaved.length) {
      remaining.push({
        id,
        before: pickFields(before, unsaved),
        after: pickFields(after, unsaved),
      });
    }
  }
  return {moved, remaining};
}

export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
