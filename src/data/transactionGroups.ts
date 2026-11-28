import {isSplitOrGrouped, type DataSource, type Group, type Row} from './api';
import {equalField, type EditKind, type WriteIssue} from './editChanges';

export type GroupIntent = {kind: 'group'; ids: number[]};
type GroupChange = {kind: 'membership'; before: Group[]; after: Group[]};
export type GroupEdit = {label: string; group: GroupIntent | GroupChange};
type GroupReceipt = {
  applied?: GroupChange;
  remaining?: GroupChange;
  issues: WriteIssue[];
};

type GroupState = {members: Row[]; parents: Row[]};

export function canGroupTransaction(row: Row) {
  return (
    !isSplitOrGrouped(row) &&
    typeof row.recurring_id !== 'number' &&
    !row.is_pending &&
    row.status !== 'delete_pending'
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

function describe({parents}: GroupState) {
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

export async function persistGroupEdit(
  source: DataSource,
  edit: GroupEdit['group'],
  kind: EditKind,
  sync: (previousParents: Row[], current: GroupState, issues: WriteIssue[]) => void,
): Promise<GroupReceipt> {
  const ids =
    edit.kind === 'membership'
      ? [...new Set([...edit.before, ...edit.after].flatMap(group => group.ids))]
      : edit.ids;
  const initial = await readState(source, ids);
  const before = describe(initial);
  let current = initial;
  const issues: WriteIssue[] = [];
  const expected =
    edit.kind === 'membership' ? (kind === 'undo' ? edit.after : edit.before) : [];
  if (!sameGroups(before, expected)) {
    sync(initial.parents, initial, issues);
    throw new Error('The transaction groups changed in Lunch Money.');
  }

  const target =
    edit.kind === 'membership'
      ? kind === 'undo'
        ? edit.before
        : edit.after
      : [planGroup(initial.members)];
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
    initial.members.some(row => !canGroupTransaction({...row, group_parent_id: null}))
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
      const observedGroups = describe(observed);
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

  const after = describe(current);
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
