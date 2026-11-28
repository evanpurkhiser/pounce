import {
  currentMonth,
  inRange,
  shiftMonth,
  type DataSource,
  type Metadata,
  type Row,
} from './api';

export function demoSource(): DataSource {
  const month = currentMonth();
  const names = [
    'MUD Coffee',
    'Union Square Greenmarket',
    'OMNY',
    'Books Are Magic',
    'Superiority Burger',
    'Good Eggs',
    'Criterion Channel',
    'Muji',
    'Sofreh',
    'Trader Joe’s',
    'Metro-North',
    'McNally Jackson',
  ];
  const categories = [null, 2, 4, null, 1, 2, 5, 3, 1, 2, 4, 3];
  const metadata: Metadata = {
    currency: 'usd',
    cadence: 'month',
    categories: [
      {id: '0', label: 'Uncategorized'},
      {id: '10', label: 'Food', group: true, members: [1, 2]},
      {
        id: '1',
        label: 'Dining out',
        groupLabel: 'Food',
        aliases: ['restaurants', 'eating out', 'Food'],
      },
      {id: '2', label: 'Groceries', groupLabel: 'Food', aliases: ['Food']},
      {id: '3', label: 'Shopping'},
      {id: '4', label: 'Transportation'},
      {id: '5', label: 'Subscriptions'},
      {id: '6', label: 'Fees'},
    ],
    tags: [
      {id: '1', label: 'Travel'},
      {id: '2', label: 'Work'},
      {id: '3', label: 'Shared'},
    ],
    accounts: [
      {id: 'cash', label: 'Cash'},
      {id: 'manual:1', label: 'Checking'},
      {id: 'plaid:2', label: 'Credit card'},
    ],
  };
  let rows: Row[] = [month, shiftMonth(month, -1), shiftMonth(month, -2)].flatMap(
    (date, index) =>
      names.map((payee, position): Row => ({
        id: index * 100 + position + 1,
        date: `${date}-${String(24 - position)}`,
        payee,
        original_name: payee.toUpperCase(),
        notes: position === 1 ? 'Produce and bread' : null,
        category_id: categories[position] ?? null,
        amount: (position * 6.37 + 4.15).toFixed(2),
        currency: 'usd',
        to_base: position * 6.37 + 4.15,
        tag_ids:
          position === 11
            ? []
            : position % 3 === 1
              ? [2]
              : position % 3 === 0
                ? [1]
                : [1, 3],
        manual_account_id: position % 2 ? 1 : null,
        plaid_account_id: position % 2 ? null : 2,
        is_pending: position === 7,
        status: position < 8 ? 'unreviewed' : 'reviewed',
        created_at: `${date}-01T00:00:00Z`,
        updated_at: `${date}-01T00:00:00Z`,
        external_id: null,
        recurring_id: null,
        split_parent_id: null,
        is_group_parent: false,
        group_parent_id: null,
        source: 'manual',
      })),
  );
  let nextId = Math.max(...rows.map(row => row.id)) + 1;

  return {
    async metadata() {
      return metadata;
    },
    async transactionsPage(range) {
      return {
        rows: rows.filter(
          row => typeof row.group_parent_id !== 'number' && inRange(row.date, range),
        ),
      };
    },
    async get(id) {
      const row = rows.find(item => item.id === id);
      if (!row) {
        throw new Error('Transaction ' + id + ' is missing.');
      }
      return row.is_group_parent
        ? {...row, children: rows.filter(member => member.group_parent_id === id)}
        : row;
    },
    async group({ids, date, payee, category_id, notes, status, tag_ids}) {
      if (ids.length < 2) {
        throw new Error('Grouping requires at least two transactions.');
      }

      const id = nextId++;
      const children = ids.map(memberId => {
        const member = rows.find(row => row.id === memberId);
        if (
          !member ||
          typeof member.group_parent_id === 'number' ||
          member.is_group_parent
        ) {
          throw new Error(`Cannot group transaction #${memberId}.`);
        }
        return {...member, group_parent_id: id};
      });
      const total = children.reduce((sum, row) => sum + row.to_base, 0);
      const category = children[0].category_id;
      const parent: Row = {
        ...children[0],
        id,
        date,
        payee,
        original_name: null,
        amount: total.toFixed(4),
        to_base: total,
        category_id:
          category_id === undefined
            ? children.every(row => row.category_id === category)
              ? category
              : null
            : category_id,
        notes: notes ?? null,
        status: status ?? 'reviewed',
        tag_ids: tag_ids ?? [],
        group_parent_id: null,
        is_group_parent: true,
        manual_account_id: null,
        plaid_account_id: null,
        children,
      };
      const members = new Map(children.map(row => [row.id, row]));
      rows = [...rows.map(row => members.get(row.id) ?? row), parent];
      return parent;
    },
    async ungroup(id) {
      if (!rows.some(row => row.id === id && row.is_group_parent)) {
        throw new Error(`Transaction group #${id} is missing.`);
      }

      rows = rows
        .filter(row => row.id !== id)
        .map(row => (row.group_parent_id === id ? {...row, group_parent_id: null} : row));
    },
    async summary(range) {
      return {
        aligned: true,
        categories: [1, 2, 3, 4, 5, 6].map(category_id => ({
          category_id,
          totals: {
            budgeted: category_id === 6 ? null : category_id === 2 ? 350 : 150,
            other_activity: rows
              .filter(
                row =>
                  typeof row.group_parent_id !== 'number' &&
                  row.category_id === category_id &&
                  inRange(row.date, range),
              )
              .reduce((total, row) => total + row.to_base, 0),
            recurring_activity: 0,
            recurring_remaining: 0,
            recurring_expected: 0,
          },
        })),
      };
    },
    async update(items) {
      const changes = new Map(items.map(item => [item.id, item.patch]));
      rows = rows.map(row =>
        changes.has(row.id)
          ? {...row, ...changes.get(row.id), updated_at: new Date().toISOString()}
          : row,
      );
      return rows.filter(row => changes.has(row.id));
    },
  };
}
