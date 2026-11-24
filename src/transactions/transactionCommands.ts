import {
  ArrowDownUp,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Filter,
  Redo2,
  Search,
  Undo2,
  Wallet,
  X,
} from 'lucide-react';

import type {Choice, Row} from '../data/api';
import type {CommandItem} from '../ui/commandSearch';

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
  filter: {label: 'Filter', icon: Filter, shortcut: ['f']},
  clear: {label: 'Clear filters', icon: X, shortcut: ['ctrl-f']},
  sort: {label: 'Sort by', icon: ArrowDownUp, shortcut: ['s'], aliases: ['sort']},
  search: {label: 'Search', icon: Search},
  previous: {label: 'Previous month', icon: ChevronLeft, shortcut: ['g', 'p']},
  next: {label: 'Next month', icon: ChevronRight, shortcut: ['g', 'n']},
  month: {label: 'Go to month…', icon: CalendarDays, shortcut: ['g', 'm']},
  current: {label: 'Go to current month', icon: CalendarDays, shortcut: ['g', 't']},
  undo: {label: 'Undo last edit', icon: Undo2, shortcut: ['cmd-z']},
  redo: {label: 'Redo last edit', icon: Redo2, shortcut: ['cmd-shift-z']},
} satisfies Record<string, Pick<CommandItem, 'label' | 'icon' | 'shortcut' | 'aliases'>>;

export function tableCommand(
  id: keyof typeof tableActions,
  invoke: () => void,
  submenu?: CommandItem['submenu'],
): CommandItem {
  return {id, ...tableActions[id], group: 'Table', invoke, submenu};
}

export function filterCommands(
  choices: Record<MultiValueFacet, readonly Choice[]>,
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
      shortcut: [key],
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
        shortcut: status === reviewStatusFor(rows) ? [reviewShortcut] : undefined,
        invoke: () => review(status),
      });
    }
  }
  return commands;
}
