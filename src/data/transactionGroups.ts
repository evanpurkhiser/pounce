import type {DataSource, Group, Row} from './api';
import {equalField, type EditKind, type WriteIssue} from './editChanges';

type GroupIntent = {kind: 'group' | 'ungroup'; ids: number[]};
type GroupChange = {kind: 'membership'; before: Group[]; after: Group[]};
export type GroupEdit = {label: string; group: GroupIntent | GroupChange};
type GroupState = {members: Row[]; parents: Row[]};
type GroupPlan = {initial: GroupState; before: Group[]; target: Group[]};
type GroupWrites = {removing: Row[]; creating: Group[]};
type GroupWriteResult = {parents: Row[]; issues: WriteIssue[]};
type GroupWriteOutcome = {history: Row[]; visible: GroupState; issues: WriteIssue[]};

function canGroupTransaction(row: Row) {
  return (
    !row.is_split_parent &&
    !row.is_group_parent &&
    typeof row.group_parent_id !== 'number' &&
    typeof row.recurring_id !== 'number' &&
    !row.is_pending &&
    row.status !== 'delete_pending'
  );
}

export function canGroupSelection(rows: Row[]) {
  return (
    rows.length >= 2 && rows.every(row => row.is_group_parent || canGroupTransaction(row))
  );
}

function groupDetails(row: Row, ids: number[]): Group {
  const {date, payee, category_id, notes, status, tag_ids} = row;
  if (status === 'delete_pending') {
    throw new Error(`Transaction #${row.id} has a pending deletion.`);
  }

  return {ids, date, payee, category_id, notes, status, tag_ids};
}

function membersOf(parent: Row) {
  const ids = parent.children?.map(({id}) => id);
  if (!parent.is_group_parent || !ids || ids.length < 2) {
    throw new Error(
      `Lunch Money did not return the members of transaction group #${parent.id}.`,
    );
  }

  return ids;
}

function parentIdsByMember(parents: Row[]) {
  return new Map(
    parents.flatMap(parent => membersOf(parent).map(id => [id, parent.id] as const)),
  );
}

function sameGroup(a: Group, b: Group) {
  return (
    a.ids.length === b.ids.length &&
    a.ids.every(id => b.ids.includes(id)) &&
    a.date === b.date &&
    a.payee === b.payee &&
    a.status === b.status &&
    (a.category_id ?? null) === (b.category_id ?? null) &&
    equalField('notes', a, b) &&
    equalField('tag_ids', a, b)
  );
}

function sameGroups(a: Group[], b: Group[]) {
  return (
    a.length === b.length && a.every(group => b.some(other => sameGroup(group, other)))
  );
}

function describe(parents: Row[]) {
  return parents.map(row => groupDetails(row, membersOf(row)));
}

async function readRows(source: DataSource, ids: number[]) {
  const batchSize = 16;
  const batches = Array.from({length: Math.ceil(ids.length / batchSize)}, (_, index) => {
    const start = index * batchSize;
    return ids.slice(start, start + batchSize);
  });
  const rows = await Array.fromAsync(batches, batch =>
    Promise.all(
      batch.map(async id => {
        const row = await source.get(id);
        if (row.id !== id) {
          throw new Error(`Lunch Money did not return transaction #${id}.`);
        }

        return row;
      }),
    ),
  );
  return rows.flat();
}

async function readState(source: DataSource, ids: number[]): Promise<GroupState> {
  const members = await readRows(source, ids);
  const parentIds = new Set(members.flatMap(row => row.group_parent_id ?? []));
  const parents = await readRows(source, [...parentIds]);
  return {members, parents};
}

function planGroup(members: Row[]): Group {
  const latest = members.reduce((a, b) => (b.date > a.date ? b : a));
  return {
    ids: members.map(row => row.id),
    date: latest.date,
    payee: latest.payee,
    category_id: members.every(row => row.category_id === latest.category_id)
      ? latest.category_id
      : null,
    notes: null,
    tag_ids: [],
    status: members.every(row => row.status === 'reviewed') ? 'reviewed' : 'unreviewed',
  };
}

async function readMembers(source: DataSource, parents: Row[]) {
  const parentByMember = parentIdsByMember(parents);
  const members = await readRows(source, [...parentByMember.keys()]);
  if (members.some(row => row.group_parent_id !== parentByMember.get(row.id))) {
    throw new Error('The transaction groups changed in Lunch Money.');
  }

  return members;
}

async function planIntent(
  source: DataSource,
  {kind, ids}: GroupIntent,
): Promise<GroupPlan> {
  const selected = await readRows(source, ids);
  const parents = selected.filter(row => row.is_group_parent);
  if (kind === 'ungroup' && !parents.length) {
    throw new Error('Select at least one transaction group.');
  }

  if (kind === 'group' && !canGroupSelection(selected)) {
    throw new Error('Grouping requires at least two eligible transactions or groups.');
  }

  const grouped = await readMembers(source, parents);
  const before = describe(parents);
  if (kind === 'ungroup') {
    return {initial: {members: grouped, parents}, before, target: []};
  }

  const members = [...grouped, ...selected.filter(row => !row.is_group_parent)];
  const [firstGroup] = parents;
  const target = firstGroup
    ? groupDetails(
        firstGroup,
        members.map(row => row.id),
      )
    : planGroup(members);
  return {initial: {members, parents}, before, target: [target]};
}

async function planReplay(
  source: DataSource,
  edit: GroupChange,
  kind: EditKind,
): Promise<GroupPlan> {
  const [expected, target] =
    kind === 'undo' ? [edit.after, edit.before] : [edit.before, edit.after];
  const ids = [...new Set([...expected, ...target].flatMap(group => group.ids))];
  const initial = await readState(source, ids);
  const before = describe(initial.parents);
  if (!sameGroups(before, expected)) {
    throw new Error('The transaction groups changed in Lunch Money.');
  }

  return {initial, before, target};
}

function planWrites({initial, before, target}: GroupPlan): GroupWrites {
  const removing = initial.parents.filter(
    (_, index) => !target.some(group => sameGroup(group, before[index])),
  );
  const creating = target.filter(group => !before.some(other => sameGroup(group, other)));
  const groupingIds = new Set(creating.flatMap(group => group.ids));

  // A group can carry attachments that cannot be restored by the group endpoint.
  if (removing.some(row => row.files?.length)) {
    throw new Error(
      'Remove the attachments from the transaction groups before changing their membership.',
    );
  }

  if (
    creating.some(group => group.ids.length < 2) ||
    initial.members.some(
      row =>
        groupingIds.has(row.id) && !canGroupTransaction({...row, group_parent_id: null}),
    )
  ) {
    throw new Error('Grouping requires at least two eligible transactions.');
  }

  return {removing, creating};
}

async function createGroup(source: DataSource, group: Group) {
  const parent = await source.group(group);
  const confirmed = membersOf(parent);
  if (
    confirmed.length !== group.ids.length ||
    !confirmed.every(id => group.ids.includes(id))
  ) {
    throw new Error('Lunch Money returned different group members.');
  }

  return parent;
}

async function writeGroups(
  source: DataSource,
  initial: GroupState,
  {removing, creating}: GroupWrites,
): Promise<GroupWriteResult> {
  let parents = initial.parents;
  try {
    for (const {id} of removing) {
      await source.ungroup(id);
      parents = parents.filter(row => row.id !== id);
    }

    for (const group of creating) {
      const parent = await createGroup(source, group);
      parents = [...parents, parent];
    }
  } catch (error) {
    const ids = initial.members.map(row => row.id);
    return {parents, issues: [{kind: 'requestFailed', operation: 'write', ids, error}]};
  }

  return {parents, issues: []};
}

async function reconcileWrite(
  source: DataSource,
  {initial: {members}, before, target}: GroupPlan,
  {parents, issues}: GroupWriteResult,
): Promise<GroupWriteOutcome> {
  const parentByMember = parentIdsByMember(parents);
  const confirmed = {
    parents,
    members: members.map(row => ({
      ...row,
      group_parent_id: parentByMember.get(row.id) ?? null,
    })),
  };
  if (!issues.length) {
    return {history: parents, visible: confirmed, issues};
  }

  const ids = members.map(row => row.id);
  try {
    const visible = await readState(source, ids);
    // A lost response can hide a successful write. Only include groups from
    // the starting or requested membership in this edit's history.
    const knownGroups = [...before, ...target];
    const matches = describe(visible.parents).every(group =>
      knownGroups.some(candidate => sameGroup(group, candidate)),
    );
    return {history: matches ? visible.parents : parents, visible, issues};
  } catch (error) {
    const issue: WriteIssue = {kind: 'requestFailed', operation: 'read', ids, error};
    return {history: parents, visible: confirmed, issues: [...issues, issue]};
  }
}

function membershipChange(
  kind: EditKind,
  from: Group[],
  to: Group[],
): GroupChange | undefined {
  if (sameGroups(from, to)) {
    return undefined;
  }

  const [before, after] = kind === 'undo' ? [to, from] : [from, to];
  return {kind: 'membership', before, after};
}

function groupReceipt(
  kind: EditKind,
  {initial, before, target}: GroupPlan,
  writtenParents: Row[],
  {history, visible, issues}: GroupWriteOutcome,
) {
  const after = describe(history);
  const visibleIds = new Set(visible.parents.map(row => row.id));
  const previousIds = new Set([...initial.parents, ...writtenParents].map(row => row.id));
  return {
    applied: membershipChange(kind, before, after),
    remaining: membershipChange(kind, after, target),
    removedParentIds: [...previousIds].filter(id => !visibleIds.has(id)),
    rows: [...visible.members, ...visible.parents],
    issues,
  };
}

export async function persistGroupEdit(
  source: DataSource,
  edit: GroupEdit['group'],
  kind: EditKind,
) {
  const plan =
    edit.kind === 'membership'
      ? await planReplay(source, edit, kind)
      : await planIntent(source, edit);
  const written = await writeGroups(source, plan.initial, planWrites(plan));
  const outcome = await reconcileWrite(source, plan, written);
  return groupReceipt(kind, plan, written.parents, outcome);
}
