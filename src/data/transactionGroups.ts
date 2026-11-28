import {isSplitOrGrouped, type DataSource, type Group, type Row} from './api';
import {equalField, type EditKind, type WriteIssue} from './editChanges';

type GroupIntent = {kind: 'group' | 'ungroup'; ids: number[]};
type GroupChange = {kind: 'membership'; before: Group[]; after: Group[]};
export type GroupEdit = {label: string; group: GroupIntent | GroupChange};
type GroupReceipt = {
  applied?: GroupChange;
  remaining?: GroupChange;
  issues: WriteIssue[];
};

type GroupState = {members: Row[]; parents: Row[]};
type GroupPlan = {initial: GroupState; target: Group[]};

function canGroupTransaction(row: Row) {
  return (
    !isSplitOrGrouped(row) &&
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
  const rows: Row[] = [];
  for (let index = 0; index < ids.length; index += 16) {
    const batch = await Promise.all(
      ids.slice(index, index + 16).map(async id => {
        const row = await source.get(id);
        if (row.id !== id) {
          throw new Error(`Lunch Money did not return transaction #${id}.`);
        }

        return row;
      }),
    );
    rows.push(...batch);
  }

  return rows;
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
  const parentByMember = new Map(
    parents.flatMap(parent => membersOf(parent).map(id => [id, parent.id] as const)),
  );
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
  if (kind === 'ungroup') {
    if (!parents.length) {
      throw new Error('Select at least one transaction group.');
    }

    const members = await readMembers(source, parents);
    return {initial: {members, parents}, target: []};
  }

  if (!canGroupSelection(selected)) {
    throw new Error('Grouping requires at least two eligible transactions or groups.');
  }

  const standalone = selected.filter(row => !row.is_group_parent);
  const members = [...(await readMembers(source, parents)), ...standalone];
  const [firstGroup] = parents;
  const target = firstGroup
    ? groupDetails(
        firstGroup,
        members.map(row => row.id),
      )
    : planGroup(members);
  return {initial: {members, parents}, target: [target]};
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
  if (!sameGroups(describe(initial.parents), expected)) {
    throw new Error('The transaction groups changed in Lunch Money.');
  }

  return {initial, target};
}

export async function persistGroupEdit(
  source: DataSource,
  edit: GroupEdit['group'],
  kind: EditKind,
  sync: (previousParents: Row[], current: GroupState, issues: WriteIssue[]) => void,
): Promise<GroupReceipt> {
  const {initial, target} =
    edit.kind === 'membership'
      ? await planReplay(source, edit, kind)
      : await planIntent(source, edit);
  const before = describe(initial.parents);
  const ids = initial.members.map(row => row.id);
  let current = initial;
  const issues: WriteIssue[] = [];
  const removing = initial.parents.filter(
    (_, index) => !target.some(group => sameGroup(group, before[index])),
  );
  const creating = target.filter(group => !before.some(other => sameGroup(group, other)));

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
        creating.some(group => group.ids.includes(row.id)) &&
        !canGroupTransaction({...row, group_parent_id: null}),
    )
  ) {
    throw new Error('Grouping requires at least two eligible transactions.');
  }

  try {
    for (const parent of removing) {
      await source.ungroup(parent.id);
      current = {
        parents: current.parents.filter(row => row.id !== parent.id),
        members: current.members.map(row =>
          row.group_parent_id === parent.id ? {...row, group_parent_id: null} : row,
        ),
      };
    }

    for (const group of creating) {
      const parent = await source.group(group);
      const confirmed = membersOf(parent);
      if (
        confirmed.length !== group.ids.length ||
        !confirmed.every(id => group.ids.includes(id))
      ) {
        throw new Error('Lunch Money returned different group members.');
      }
      current = {
        parents: [...current.parents, parent],
        members: current.members.map(row =>
          group.ids.includes(row.id) ? {...row, group_parent_id: parent.id} : row,
        ),
      };
    }
  } catch (error) {
    issues.push({kind: 'requestFailed', operation: 'write', ids, error});
    try {
      const observed = await readState(source, ids);
      const observedGroups = describe(observed.parents);
      sync([...initial.parents, ...current.parents], observed, issues);

      // A request can succeed even if its response is lost. Only attribute
      // groups from this command's starting or requested state to the write.
      if (
        observedGroups.every(group =>
          [...before, ...target].some(candidate => sameGroup(group, candidate)),
        )
      ) {
        current = observed;
      }
    } catch (readError) {
      issues.push({kind: 'requestFailed', operation: 'read', ids, error: readError});
      sync(initial.parents, current, issues);
    }
  }

  if (!issues.length) {
    sync(initial.parents, current, issues);
  }

  const after = describe(current.parents);
  const change = (from: Group[], to: Group[]): GroupChange =>
    kind === 'undo'
      ? {kind: 'membership', before: to, after: from}
      : {kind: 'membership', before: from, after: to};

  return {
    applied: sameGroups(before, after) ? undefined : change(before, after),
    remaining: sameGroups(after, target) ? undefined : change(after, target),
    issues,
  };
}
