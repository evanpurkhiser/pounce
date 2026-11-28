import type {Group, Row} from './api';
import type {EditKind} from './editChanges';
import {canGroupSelection, groupTarget, type GroupEdit} from './transactionGroups';

type GroupIntent = Exclude<GroupEdit['group'], {kind: 'membership'}>;
type GroupChange = Extract<GroupEdit['group'], {kind: 'membership'}>;
type Layout = {parents: Row[]; members: Row[]; target: Group[]};

function intentLayout(rows: Row[], {kind, ids}: GroupIntent): Layout | undefined {
  const byId = new Map(rows.map(row => [row.id, row]));
  const selected = ids.flatMap(id => byId.get(id) ?? []);
  if (
    selected.length !== ids.length ||
    (kind === 'group' && !canGroupSelection(selected))
  ) {
    return undefined;
  }

  const parents = selected.filter(row => row.is_group_parent);
  if (parents.some(row => !row.children?.length || row.status === 'delete_pending')) {
    return undefined;
  }

  const grouped = parents.flatMap(row => row.children ?? []);
  if (kind === 'ungroup') {
    return {parents, members: grouped, target: []};
  }

  const members = [...grouped, ...selected.filter(row => !row.is_group_parent)];
  return {parents, members, target: [groupTarget(members, parents[0])]};
}

function replayLayout(
  rows: Row[],
  {before, after}: GroupChange,
  kind: EditKind,
): Layout | undefined {
  const ids = new Set([...before, ...after].flatMap(group => group.ids));
  const parents = rows.filter(
    row =>
      row.is_group_parent &&
      row.children?.length &&
      row.children.every(child => ids.has(child.id)),
  );
  const members = [
    ...parents.flatMap(row => row.children ?? []),
    ...rows.filter(row => ids.has(row.id)),
  ];
  const available = new Set(members.map(row => row.id));
  if ([...ids].some(id => !available.has(id))) {
    return undefined;
  }

  return {parents, members, target: kind === 'undo' ? before : after};
}

function previewParent(
  group: Group,
  parents: Row[],
  members: Map<number, Row>,
  baseCurrency?: Row['currency'],
): Row | undefined {
  // Keep the real row once Lunch Money has confirmed this membership.
  const existing = parents.find(
    row =>
      row.children?.length === group.ids.length &&
      row.children.every(child => group.ids.includes(child.id)),
  );
  if (existing) {
    return existing;
  }

  const children = group.ids.flatMap(id => members.get(id) ?? []);
  const first = children[0];
  if (!first || children.length !== group.ids.length) {
    return undefined;
  }

  const sameCurrency = children.every(row => row.currency === first.currency);
  const currency = sameCurrency ? first.currency : baseCurrency;
  if (!currency) {
    return undefined;
  }

  // Member IDs are unique across groups, so the smallest one gives the preview a stable ID.
  const id = -group.ids.reduce((smallest, member) => Math.min(smallest, member));
  return {
    id,
    date: group.date,
    payee: group.payee,
    category_id: group.category_id ?? null,
    notes: group.notes ?? null,
    tag_ids: group.tag_ids ?? [],
    status: group.status ?? 'reviewed',
    currency,
    amount: children
      .reduce((sum, row) => sum + (sameCurrency ? Number(row.amount) : row.to_base), 0)
      .toFixed(4),
    to_base: children.reduce((sum, row) => sum + row.to_base, 0),
    created_at: first.created_at,
    updated_at: first.updated_at,
    is_pending: false,
    is_group_parent: true,
    group_parent_id: null,
    split_parent_id: null,
    manual_account_id: null,
    plaid_account_id: null,
    recurring_id: null,
    external_id: null,
    source: null,
    children: children.map(row => ({...row, group_parent_id: id})),
  };
}

export function projectGroupRows(
  rows: Row[],
  edit: GroupEdit['group'],
  kind: EditKind,
  baseCurrency?: Row['currency'],
) {
  const layout =
    edit.kind === 'membership'
      ? replayLayout(rows, edit, kind)
      : intentLayout(rows, edit);
  if (!layout) {
    return rows;
  }

  const {parents, members, target} = layout;
  const memberRows = new Map(members.map(row => [row.id, row]));
  const nextParents = target.flatMap(
    group => previewParent(group, parents, memberRows, baseCurrency) ?? [],
  );
  if (nextParents.length !== target.length) {
    return rows;
  }

  const affected = new Set([...parents, ...members].map(row => row.id));
  const grouped = new Set(target.flatMap(group => group.ids));
  return [
    ...rows.filter(row => !affected.has(row.id)),
    ...[...memberRows.values()]
      .filter(row => !grouped.has(row.id))
      .map(row => ({...row, group_parent_id: null})),
    ...nextParents,
  ];
}
