import {memo} from 'react';

import {useQuery} from '@tanstack/react-query';
import {ChevronRight} from 'lucide-react';

import {monthRange, money, shiftMonth, type Metadata} from '../data/api';
import {message, type Session} from '../data/session';
import ui from '../ui/ui.module.css';

import styles from './Budget.module.css';

type BudgetRow = {
  categoryId: number;
  limit: number | null;
  spent: number;
  period: string;
};
type BudgetNode = BudgetRow & {children?: BudgetRow[]};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function groupTargets(rows: BudgetRow[], metadata?: Metadata): BudgetNode[] {
  const groups = metadata?.categories.filter(category => category.group) ?? [];
  const parents = new Map(
    groups.flatMap(group =>
      (group.members ?? []).map(id => [id, Number(group.id)] as const),
    ),
  );
  const groupIds = new Set(groups.map(group => Number(group.id)));
  const nodes: BudgetNode[] = [];

  for (const periodRows of Map.groupBy(rows, row => row.period).values()) {
    const byCategory = new Map(periodRows.map(row => [row.categoryId, row]));
    const children = Map.groupBy(
      periodRows.filter(row => parents.has(row.categoryId)),
      row => parents.get(row.categoryId),
    );
    for (const group of groups) {
      const categoryId = Number(group.id);
      const totals = byCategory.get(categoryId);
      const members = children.get(categoryId) ?? [];
      if (!totals && !members.length) {
        continue;
      }
      const limits = members.flatMap(member =>
        member.limit === null ? [] : [member.limit],
      );

      nodes.push({
        categoryId,
        period: periodRows[0].period,
        limit: totals?.limit ?? (limits.length ? sum(limits) : null),
        spent: totals?.spent ?? sum(members.map(member => member.spent)),
        children: members,
      });
    }

    nodes.push(
      ...periodRows.filter(
        row => !parents.has(row.categoryId) && !groupIds.has(row.categoryId),
      ),
    );
  }

  return nodes;
}

export const Budget = memo(function Budget({
  session,
  month,
  metadata,
  hidden,
}: {
  session: Session;
  month: string;
  metadata?: Metadata;
  hidden: boolean;
}) {
  const range = monthRange(month);
  const budget = useQuery({
    queryKey: ['budget', month],
    queryFn: ({signal}) => session.source.summary(range, signal),
  });
  const padding = metadata?.cadence === 'year' ? 12 : 2;
  const periods = useQuery({
    queryKey: ['budget', month, 'periods', padding],
    enabled: Boolean(metadata) && budget.data?.aligned === false,
    queryFn: ({signal}) =>
      session.source.summary(
        {
          start: monthRange(shiftMonth(month, -padding)).start,
          end: monthRange(shiftMonth(month, padding)).end,
        },
        signal,
      ),
  });
  const aligned =
    budget.data?.categories.map(({category_id, totals}) => ({
      categoryId: category_id,
      limit: totals.budgeted ?? null,
      spent: totals.other_activity + totals.recurring_activity,
      period: '',
    })) ?? [];
  const overlapping =
    periods.data?.categories.flatMap(({category_id, occurrences}) =>
      (occurrences ?? []).flatMap(occurrence =>
        occurrence.start_date > range.end || occurrence.end_date < range.start
          ? []
          : [
              {
                categoryId: category_id,
                limit: occurrence.budgeted ?? null,
                spent: occurrence.other_activity + occurrence.recurring_activity,
                period: `${occurrence.start_date} – ${occurrence.end_date}`,
              },
            ],
      ),
    ) ?? [];
  const withPeriods = new Set(overlapping.map(row => row.categoryId));
  const targets = groupTargets(
    budget.data?.aligned
      ? aligned
      : [
          ...overlapping,
          ...aligned.filter(
            row => row.limit === null && !withPeriods.has(row.categoryId),
          ),
        ],
    metadata,
  );
  const currency = metadata?.currency ?? 'usd';
  const formatBudget = (amount: number) => money(amount, currency, 0);

  function budgetItem(row: BudgetRow) {
    const label =
      metadata?.categories.find(choice => Number(choice.id) === row.categoryId)?.label ??
      `Category ${row.categoryId}`;
    return (
      <>
        <span className={styles.budgetAmount}>
          {label}
          <span>
            {formatBudget(row.spent)}
            {row.limit === null ? '' : ` / ${formatBudget(row.limit)}`}
          </span>
        </span>
        {row.period && <small>{row.period}</small>}
        {row.limit !== null && row.limit > 0 ? (
          <meter
            aria-label={`${label} budget used${row.period ? ' · ' + row.period : ''}`}
            min={0}
            max={row.limit}
            value={Math.max(0, Math.min(row.spent, row.limit))}
          />
        ) : (
          <span
            className={styles.budgetUnset}
            role="img"
            aria-label={
              label +
              (row.limit === 0 ? ' has a zero budget target' : ' has no budget target')
            }
          />
        )}
      </>
    );
  }

  return (
    <div className={styles.column} hidden={hidden}>
      <aside id="monthly-budget" className={styles.budget} aria-label="Monthly budget">
        <h2>Monthly budget</h2>
        {budget.isPending && <p role="status">Loading budget…</p>}
        {budget.isError && (
          <p role="alert">
            {message(budget.error)}{' '}
            <button type="button" onClick={() => void budget.refetch()}>
              Retry
            </button>
          </p>
        )}
        {budget.data?.aligned && !targets.some(row => row.limit !== null) && (
          <p>No category targets for this month.</p>
        )}
        {budget.data?.aligned === false && (
          <p>
            Budget cadence: {metadata?.cadence ?? 'custom'}. Targets are grouped by budget
            period.
          </p>
        )}
        {periods.isFetching && <p role="status">Loading budget periods…</p>}
        {periods.isError && (
          <p role="alert">
            {message(periods.error)}{' '}
            <button type="button" onClick={() => void periods.refetch()}>
              Retry periods
            </button>
          </p>
        )}
        {periods.isSuccess && !targets.length && (
          <p>No budget periods with targets overlap this month.</p>
        )}
        <ul className={styles.budgetList}>
          {targets.map(row => (
            <li key={row.categoryId + row.period} className={styles.budgetItem}>
              {row.children?.length ? (
                <details open>
                  <summary>
                    <ChevronRight className={ui.actionIcon} aria-hidden />
                    {budgetItem(row)}
                  </summary>
                  <ul className={`${styles.budgetList} ${styles.budgetChildren}`}>
                    {row.children.map(child => (
                      <li key={child.categoryId} className={styles.budgetItem}>
                        {budgetItem(child)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                budgetItem(row)
              )}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
});
