import {useMemo} from 'react';

import {
  createParser,
  parseAsNativeArrayOf,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from 'nuqs';

import type {Metadata, Range, Row} from '../data/api';

import {columns, defaultSort, type SortDescriptor} from './sorting';
import {reviewStatuses, type ReviewStatus} from './transactionActions';
import {
  multiValueFacets,
  selectTransactions,
  type Facet,
  type MultiValueFacet,
  type TransactionFilters,
} from './transactionView';

const filterIds = parseAsNativeArrayOf(
  createParser({
    parse: value => (/^\d+$/.test(value) ? value : null),
    serialize: (value: string) => value,
  }),
);

const viewParams = {
  review: parseAsStringLiteral(reviewStatuses),
  category: filterIds,
  tag: filterIds,
  account: parseAsNativeArrayOf(
    createParser({
      parse: value => (/^(?:cash|(?:manual|plaid):\d+)$/.test(value) ? value : null),
      serialize: (value: string) => value,
    }),
  ),
  q: parseAsString.withDefault('').withOptions({history: 'replace'}),
  sort: createParser<SortDescriptor>({
    parse(value) {
      const [id, direction, ...extra] = value.split(':');
      const column = columns.find(item => item.id === id)?.id;
      if (
        !column ||
        extra.length ||
        (direction !== 'ascending' && direction !== 'descending')
      ) {
        return null;
      }

      return {column, direction};
    },
    serialize: ({column, direction}) => `${column}:${direction}`,
    eq: (left, right) =>
      left.column === right.column && left.direction === right.direction,
  }),
};

export function useTransactionView(
  rows: Row[],
  {start, end}: Range,
  metadata?: Metadata,
) {
  const [{review, category, tag, account, q: search, sort}, setView] = useQueryStates(
    viewParams,
    {history: 'push'},
  );
  const filters = useMemo<TransactionFilters>(
    () => ({review, category, tag, account}),
    [review, category, tag, account],
  );
  const visible = useMemo(
    () => selectTransactions(rows, {start, end}, filters, search, sort, metadata),
    [rows, start, end, filters, search, sort, metadata],
  );
  const gridSort = sort ?? (search ? undefined : defaultSort);
  const activeFilters: Array<{facet: Facet; id: string}> = [
    ...(review ? [{facet: 'review' as const, id: review}] : []),
    ...multiValueFacets.flatMap(facet => filters[facet].map(id => ({facet, id}))),
  ];

  return {
    filters,
    activeFilters,
    search,
    sort,
    gridSort,
    visible,
    setSearch: (value: string) => void setView({q: value}),
    setSort: (next?: SortDescriptor) => void setView({sort: next ?? null}),
    setReview: (status: ReviewStatus | null) => void setView({review: status}),
    chooseFacet: (facet: MultiValueFacet, id: string) => void setView({[facet]: [id]}),
    toggleFacet(facet: Facet, id: string) {
      if (facet === 'review') {
        void setView({review: null});
        return;
      }

      void setView(previous => {
        const values = previous[facet];
        return {
          [facet]: values.includes(id)
            ? values.filter(value => value !== id)
            : [...values, id],
        };
      });
    },
    clearFilters: () =>
      void setView(
        {review: null, category: null, tag: null, account: null, q: null},
        {history: 'push'},
      ),
  };
}
