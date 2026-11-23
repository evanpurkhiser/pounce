import type {Metadata, Row} from './api';

const dateColumn = {
  id: 'date',
  label: 'Date',
  directions: ['Oldest first', 'Newest first'],
  defaultDirection: 'descending',
} as const;

export const columns = [
  dateColumn,
  {
    id: 'category',
    label: 'Category',
    directions: ['A to Z', 'Z to A'],
    defaultDirection: 'ascending',
  },
  {
    id: 'payee',
    label: 'Payee',
    directions: ['A to Z', 'Z to A'],
    defaultDirection: 'ascending',
  },
  {
    id: 'amount',
    label: 'Amount',
    directions: ['Lowest first', 'Highest first'],
    defaultDirection: 'ascending',
  },
  {
    id: 'note',
    label: 'Note',
    directions: ['A to Z', 'Z to A'],
    defaultDirection: 'ascending',
  },
  {
    id: 'tags',
    label: 'Tags',
    directions: ['A to Z', 'Z to A'],
    defaultDirection: 'ascending',
  },
  {
    id: 'review',
    label: 'Review',
    directions: ['Unreviewed first', 'Reviewed first'],
    defaultDirection: 'ascending',
  },
] as const;

export type SortColumn = (typeof columns)[number]['id'];
export type SortDescriptor = {column: SortColumn; direction: 'ascending' | 'descending'};

export const defaultSort: SortDescriptor = {
  column: dateColumn.id,
  direction: dateColumn.defaultDirection,
};

const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

export function categoryName(row: Row, metadata?: Metadata) {
  return (
    metadata?.categories.find(item => item.id === String(row.category_id ?? 0))?.label ??
    (typeof row.category_id !== 'number'
      ? 'Uncategorized'
      : `Category ${row.category_id}`)
  );
}

export function tagNames(row: Row, metadata?: Metadata) {
  return row.tag_ids.map(
    id => metadata?.tags.find(tag => tag.id === String(id))?.label ?? `#${id}`,
  );
}

export function reviewLabel(row: Row) {
  if (row.status === 'delete_pending') {
    return 'Needs attention';
  }
  return row.status === 'reviewed' ? 'Reviewed' : 'Unreviewed';
}

function sortValue(
  row: Row,
  column: SortDescriptor['column'],
  metadata?: Metadata,
): string | number {
  switch (column) {
    case 'category':
      return categoryName(row, metadata);
    case 'payee':
      return row.payee;
    case 'amount':
      return row.to_base;
    case 'note':
      return row.notes ?? '';
    case 'tags':
      return tagNames(row, metadata).join(', ');
    case 'review':
      return row.status === 'reviewed' ? 1 : 0;
    default:
      return row.date;
  }
}

export function sortTransactions(rows: Row[], sort: SortDescriptor, metadata?: Metadata) {
  const direction = sort.direction === 'ascending' ? 1 : -1;
  return rows
    .map(row => ({row, value: sortValue(row, sort.column, metadata)}))
    .sort((a, b) => {
      const order =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value));
      return (
        direction * order || b.row.date.localeCompare(a.row.date) || b.row.id - a.row.id
      );
    })
    .map(item => item.row);
}
