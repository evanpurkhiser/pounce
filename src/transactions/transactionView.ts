import {accountKey, inRange, type Metadata, type Range, type Row} from '../data/api';
import {rank} from '../ui/search';

import {defaultSort, sortTransactions, type SortDescriptor} from './sorting';
import type {ReviewStatus} from './transactionActions';

export const multiValueFacets = ['category', 'tag', 'account'] as const;
export type MultiValueFacet = (typeof multiValueFacets)[number];
export type Facet = 'review' | MultiValueFacet;
export type TransactionFilters = Record<MultiValueFacet, readonly string[]> & {
  review: ReviewStatus | null;
};

export function selectTransactions(
  rows: Row[],
  range: Range,
  filters: TransactionFilters,
  search: string,
  sort: SortDescriptor | null,
  metadata?: Metadata,
) {
  const categories = new Set(filters.category.map(Number));
  if (categories.size) {
    const categoryIds = new Set(filters.category);
    for (const {id, members} of metadata?.categories ?? []) {
      if (categoryIds.has(id)) {
        members?.forEach(member => categories.add(member));
      }
    }
  }

  const tags = new Set(filters.tag.map(Number));
  const accounts = new Set(filters.account);
  const matches = rows.filter(
    row =>
      inRange(row.date, range) &&
      (!categories.size || categories.has(row.category_id ?? 0)) &&
      (!tags.size || row.tag_ids.some(id => tags.has(id))) &&
      (!accounts.size || accounts.has(accountKey(row))) &&
      (!filters.review || filters.review === row.status),
  );

  if (!search) {
    return sortTransactions(matches, sort ?? defaultSort, metadata);
  }

  // Unsorted search uses newest first as the relevance tiebreaker.
  const candidates = sort ? matches : sortTransactions(matches, defaultSort, metadata);
  const results = rank(
    candidates.map(row => ({
      row,
      label: row.payee,
      aliases: [row.original_name ?? '', row.notes ?? ''],
    })),
    search,
  ).map(item => item.row);
  return sort ? sortTransactions(results, sort, metadata) : results;
}
