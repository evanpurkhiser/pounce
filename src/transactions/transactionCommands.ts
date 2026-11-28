import {
  ArrowDownUp,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Filter,
  Group,
  Redo2,
  Search,
  Undo2,
  Ungroup,
  Wallet,
  X,
} from 'lucide-react';

import type {Choice, Row} from '../data/api';
import {canGroupSelection, type GroupEdit} from '../data/transactionGroups';
import type {CommandItem} from '../ui/commandSearch';
import {shortcuts} from '../ui/shortcuts';

import {columns, type SortDescriptor} from './sorting';
import {
  editActions,
  editTitle,
  reviewIcons,
  reviewShortcut,
  reviewStatusFor,
  reviewStatuses,
  reviewTargets,
  transactionCountLabel,
  type Field,
  type ReviewStatus,
} from './transactionActions';
import {
  multiValueFacets,
  type MultiValueFacet,
  type TransactionFilters,
} from './transactionView';

export const facetLabels = {
  category: 'Category',
  tag: 'Tag',
  account: 'Account',
} satisfies Record<MultiValueFacet, string>;
const facetIcons = {
  category: editActions.category.icon,
  tag: editActions.tags.icon,
  account: Wallet,
};
export const reviews = [
  {id: 'unreviewed', label: 'Unreviewed'},
  {id: 'reviewed', label: 'Reviewed'},
  {id: '', label: 'Any review status'},
] as const;

const tableActions = {
  filter: {label: 'Filter', icon: Filter, shortcut: shortcuts.filter},
  clear: {label: 'Clear filters', icon: X, shortcut: shortcuts.clearFilters},
  sort: {
    label: 'Sort by',
    icon: ArrowDownUp,
    shortcut: shortcuts.sort,
    aliases: ['sort'],
  },
  search: {label: 'Search', icon: Search},
  previous: {
    label: 'Previous month',
    icon: ChevronLeft,
    shortcut: shortcuts.previousMonth,
  },
  next: {label: 'Next month', icon: ChevronRight, shortcut: shortcuts.nextMonth},
  month: {label: 'Go to month…', icon: CalendarDays, shortcut: shortcuts.pickMonth},
  current: {
    label: 'Go to current month',
    icon: CalendarDays,
    shortcut: shortcuts.currentMonth,
  },
  undo: {label: 'Undo last edit', icon: Undo2, shortcut: shortcuts.undo},
  redo: {label: 'Redo last edit', icon: Redo2, shortcut: shortcuts.redo},
} satisfies Record<string, Pick<CommandItem, 'label' | 'icon' | 'shortcut' | 'aliases'>>;

export function tableCommand(
  id: keyof typeof tableActions,
  invoke: () => void,
  submenu?: CommandItem['submenu'],
): CommandItem {
  return {id, ...tableActions[id], group: 'Table', invoke, submenu};
}

export function filterCommands(
  choices: Record<
    MultiValueFacet,
    ReadonlyArray<Choice & Pick<CommandItem, 'labelContent'>>
  >,
  filters: TransactionFilters,
  actions: {
    chooseReview: (status: ReviewStatus | null) => void;
    openFacet: (facet: MultiValueFacet) => void;
    chooseFacet: (facet: MultiValueFacet, id: string) => void;
    toggleFacet: (facet: MultiValueFacet, id: string) => void;
  },
  clear: CommandItem,
): CommandItem[] {
  const reviewCommands = reviews
    .filter(item => item.id !== (filters.review ?? ''))
    .map(item => ({
      id: `review:${item.id}`,
      label: item.label,
      group: 'Review status',
      icon: item.id ? reviewIcons[item.id] : Filter,
      invoke: () => actions.chooseReview(item.id || null),
    }));
  const facetCommands = multiValueFacets.map((facet): CommandItem => ({
    id: facet,
    label: facetLabels[facet],
    group: 'Filter',
    icon: facetIcons[facet],
    invoke: () => actions.openFacet(facet),
    submenu: {
      search: 'inline',
      items: () =>
        choices[facet].map(choice => ({
          ...choice,
          group: facetLabels[facet],
          invoke: () => actions.chooseFacet(facet, choice.id),
          checked: filters[facet].includes(choice.id),
          toggle: () => actions.toggleFacet(facet, choice.id),
        })),
    },
  }));
  return [...reviewCommands, ...facetCommands, clear];
}

export function sortCommands(
  sort: SortDescriptor | undefined,
  searching: boolean,
  choose: (next?: SortDescriptor) => void,
) {
  const items = columns.map(({id, label, directions, defaultDirection}): CommandItem => {
    const direction =
      sort?.column === id
        ? sort.direction === 'ascending'
          ? 'descending'
          : 'ascending'
        : defaultDirection;
    const detail = directions[direction === 'descending' ? 1 : 0];
    const icon =
      id === 'amount'
        ? DollarSign
        : id === 'review'
          ? reviewIcons.reviewed
          : editActions[id].icon;

    return {
      id,
      label,
      detail,
      icon,
      aliases: [`${label} ${detail}`],
      group: 'Sort by',
      invoke: () => choose({column: id, direction}),
    };
  });
  if (searching) {
    items.unshift({
      id: 'relevance',
      label: 'Search relevance',
      invoke: () => choose(),
      group: 'Sort by',
      icon: Search,
      detail: sort ? undefined : 'Current',
    });
  }
  return items;
}

export function transactionCommands(
  rows: Row[],
  edit: (field: Field) => void,
  review: (status: ReviewStatus) => void,
) {
  if (!rows.length) {
    return [];
  }

  const multiple = rows.length > 1;
  const commands: CommandItem[] = Object.values(editActions).map(
    ({field, key, icon}) => ({
      id: field,
      label: editTitle(field, multiple),
      icon,
      detail: multiple ? transactionCountLabel(rows.length) : undefined,
      group: 'Transactions',
      shortcut: key,
      invoke: () => edit(field),
    }),
  );
  for (const status of reviewStatuses) {
    const count = reviewTargets(rows, status).length;
    if (count) {
      commands.push({
        id: status,
        group: 'Transactions',
        label: 'Mark ' + (multiple ? count + ' ' : '') + status,
        icon: reviewIcons[status],
        shortcut: status === reviewStatusFor(rows) ? reviewShortcut : undefined,
        invoke: () => review(status),
      });
    }
  }
  return commands;
}

export function groupCommands(
  rows: Row[],
  save: (edit: GroupEdit) => void,
): Array<CommandItem & {shortcut: typeof shortcuts.group | typeof shortcuts.ungroup}> {
  const actions = [
    {
      kind: 'group',
      label: 'Group transactions',
      completion: 'Grouped transactions',
      icon: Group,
      targets: canGroupSelection(rows) ? rows : [],
    },
    {
      kind: 'ungroup',
      label: 'Ungroup transactions',
      completion: 'Ungrouped transactions',
      icon: Ungroup,
      targets: rows.filter(row => row.is_group_parent),
    },
  ] as const;

  return actions
    .filter(({targets}) => targets.length > 0)
    .map(({kind, label, completion, icon, targets}) => ({
      id: kind,
      group: 'Transactions',
      shortcut: shortcuts[kind],
      label,
      icon,
      invoke: () =>
        save({label: completion, group: {kind, ids: targets.map(row => row.id)}}),
    }));
}
