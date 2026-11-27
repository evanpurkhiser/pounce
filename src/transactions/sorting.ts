import type {Metadata, Row, TagChoice} from '../data/api';

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

export function transactionTags(row: Row, metadata?: Metadata): TagChoice[] {
  return row.tag_ids.map(
    id =>
      metadata?.tags.find(tag => tag.id === String(id)) ?? {
        id: String(id),
        label: `#${id}`,
      },
  );
}

export function reviewLabel(row: Row) {
  if (row.status === 'delete_pending') {
    return 'Needs attention';
  }
  return row.status === 'reviewed' ? 'Reviewed' : 'Unreviewed';
}

function sortText(
  row: Row,
  column: Exclude<SortColumn, 'amount' | 'review'>,
  metadata?: Metadata,
) {
  switch (column) {
    case 'category':
      return categoryName(row, metadata);
    case 'payee':
      return row.payee;
    case 'note':
      return row.notes ?? '';
    case 'tags':
      return transactionTags(row, metadata)
        .map(tag => tag.label)
        .join(', ');
    default:
      return row.date;
  }
}

export function sortTransactions(
  rows: Row[],
  {column, direction}: SortDescriptor,
  metadata?: Metadata,
) {
  const sign = direction === 'ascending' ? 1 : -1;

  function sortBy<Value>(
    valueOf: (row: Row) => Value,
    compare: (a: Value, b: Value) => number,
  ) {
    return rows
      .map(row => ({row, value: valueOf(row)}))
      .sort(
        (a, b) =>
          sign * compare(a.value, b.value) ||
          b.row.date.localeCompare(a.row.date) ||
          b.row.id - a.row.id,
      )
      .map(item => item.row);
  }

  switch (column) {
    case 'amount':
      return sortBy(
        row => row.to_base,
        (a, b) => a - b,
      );
    case 'review':
      return sortBy(
        row => Number(row.status === 'reviewed'),
        (a, b) => a - b,
      );
    default:
      return sortBy(row => sortText(row, column, metadata), collator.compare);
  }
}
