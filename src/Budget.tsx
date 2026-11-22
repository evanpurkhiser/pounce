import {useQuery} from '@tanstack/react-query';
import {message, type Session} from './data';
import {monthRange, money, shiftMonth, type Metadata} from './api';

export function Budget({session, month, metadata}: {session: Session; month: string; metadata?: Metadata}) {
  const range = monthRange(month);
  const budget = useQuery({queryKey: ['budget', month], queryFn: ({signal}) => session.source.summary(range, signal)});
  const padding = metadata?.cadence === 'year' ? 12 : 2;
  const periods = useQuery({
    queryKey: ['budget', month, 'periods', padding],
    enabled: !!metadata && budget.data?.aligned === false,
    queryFn: ({signal}) => session.source.summary({
      start: monthRange(shiftMonth(month, -padding)).start,
      end: monthRange(shiftMonth(month, padding)).end,
    }, signal),
  });
  const isGroup = (id: number) => metadata?.categories.some(choice => +choice.id === id && choice.group);
  const rows = budget.data?.categories.filter(category => !isGroup(category.category_id)) ?? [];
  const aligned = rows.flatMap(({category_id, totals}) => totals.budgeted == null ? [] : [{
    category_id, limit: totals.budgeted, spent: totals.other_activity + totals.recurring_activity, period: '',
  }]);
  const overlapping = periods.data?.categories.flatMap(({category_id, occurrences}) =>
    isGroup(category_id) ? [] : (occurrences ?? []).flatMap(occurrence =>
      occurrence.budgeted == null || occurrence.start_date > range.end || occurrence.end_date < range.start ? [] : [{
        category_id,
        limit: occurrence.budgeted,
        spent: occurrence.other_activity + occurrence.recurring_activity,
        period: occurrence.start_date + ' – ' + occurrence.end_date,
      }],
    ),
  ) ?? [];
  const targets = budget.data?.aligned ? aligned : overlapping;
  const currency = metadata?.currency ?? 'usd';
  const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

  return <aside className="budget" aria-label="Monthly budget">
    <h2>Monthly budget</h2>
    {budget.isPending && <p role="status">Loading budget…</p>}
    {budget.isError && <p role="alert">{message(budget.error)} <button onClick={() => void budget.refetch()}>Retry</button></p>}
    {budget.data?.aligned && (aligned.length ? <p>{money(total(aligned.map(row => row.spent)), currency)}
      {' of '}{money(total(aligned.map(row => row.limit)), currency)} budgeted</p> : <p>No category targets for this month.</p>)}
    {budget.data?.aligned === false && <p>Budget cadence: {metadata?.cadence ?? 'custom'}. Targets are grouped by budget period.</p>}
    {periods.isFetching && <p role="status">Loading budget periods…</p>}
    {periods.isError && <p role="alert">{message(periods.error)} <button onClick={() => void periods.refetch()}>Retry periods</button></p>}
    {periods.isSuccess && !overlapping.length && <p>No budget periods with targets overlap this month.</p>}
    {targets.map(row => {
      const label = metadata?.categories.find(choice => +choice.id === row.category_id)?.label ?? 'Category ' + row.category_id;
      return <div key={row.category_id + row.period} className="budget-item">
        <div>{label}<span>{money(row.spent, currency)} / {money(row.limit, currency)}</span></div>
        {row.period && <small>{row.period}</small>}
        {row.limit > 0 && <meter aria-label={label + ' budget used' + (row.period ? ' · ' + row.period : '')}
          min={0} max={row.limit} value={Math.max(0, Math.min(row.spent, row.limit))} />}
      </div>;
    })}
  </aside>;
}
