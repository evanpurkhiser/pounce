import {useEffect, useLayoutEffect} from 'react';

import {useInfiniteQuery} from '@tanstack/react-query';

import type {Range} from './api';
import type {Session} from './session';

export function useTransactionPages(session: Session, {start, end}: Range) {
  const query = useInfiniteQuery({
    queryKey: ['transactions', start, end],
    queryFn: ({pageParam, signal}) => session.loadPage({start, end}, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: page => page.nextOffset,
  });
  const {data, hasNextPage, isFetching, isError, fetchNextPage, refetch} = query;

  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetching, isError, fetchNextPage]);

  useLayoutEffect(() => {
    if (!data || hasNextPage || isFetching || isError) {
      return;
    }
    const applied = session.applyPages({start, end}, data.pages);
    if (!applied) {
      void refetch();
    }
  }, [session, start, end, data, hasNextPage, isFetching, isError, refetch]);

  return {
    isError,
    error: query.error,
    isPending: query.isPending || (hasNextPage && !isError),
    retry: query.isFetchNextPageError ? fetchNextPage : refetch,
  };
}
