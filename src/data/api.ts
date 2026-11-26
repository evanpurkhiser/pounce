import {getLocalTimeZone, parseDate, today} from '@internationalized/date';
import {LunchMoneyClient, type components} from '@lunch-money/lunch-money-js-v2';

type Schema = components['schemas'];
export type Row = Schema['transactionObject'];
export type Patch = Partial<
  Pick<Row, 'payee' | 'date' | 'category_id' | 'tag_ids' | 'notes'>
> & {status?: 'reviewed' | 'unreviewed'};
export type Update = {id: number; patch: Patch};
export type Range = {start: string; end: string};
export type Choice = {
  id: string;
  label: string;
  aliases?: string[];
  group?: boolean;
  groupLabel?: string;
  members?: number[];
};
export type TagChoice = Pick<Choice, 'id' | 'label'> & {
  color?: string;
};
export type Metadata = {
  categories: Choice[];
  tags: TagChoice[];
  accounts: Choice[];
  currency: string;
  cadence: string;
};
export type Summary = Schema['summaryResponseObject'];

export const currentMonth = () => today(getLocalTimeZone()).toString().slice(0, 7);
export const shiftMonth = (month: string, months: number) =>
  parseDate(`${month}-01`).add({months}).toString().slice(0, 7);
export function monthRange(month: string): Range {
  const first = parseDate(`${month}-01`);
  return {
    start: first.toString(),
    end: first.add({months: 1}).subtract({days: 1}).toString(),
  };
}
export const inRange = (date: string, range: Range) =>
  date >= range.start && date <= range.end;
export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
export function money(amount: number, currency: string, fractionDigits?: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}
export const accountKey = (row: Row) =>
  row.manual_account_id
    ? `manual:${row.manual_account_id}`
    : row.plaid_account_id
      ? `plaid:${row.plaid_account_id}`
      : 'cash';
export const isSplitOrGrouped = (row: Row) =>
  row.is_split_parent ||
  typeof row.split_parent_id === 'number' ||
  row.is_group_parent ||
  typeof row.group_parent_id === 'number';

export type TransactionPage = {rows: Row[]; nextOffset?: number};

export async function listTransactions(
  source: DataSource,
  range: Range,
  signal?: AbortSignal,
) {
  const rows = new Map<number, Row>();
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const page = await source.transactionsPage(range, offset, signal);
    for (const row of page.rows) {
      rows.set(row.id, row);
    }
    offset = page.nextOffset;
  }
  return [...rows.values()];
}

export interface DataSource {
  metadata(signal?: AbortSignal): Promise<Metadata>;
  transactionsPage(
    range: Range,
    offset: number,
    signal?: AbortSignal,
  ): Promise<TransactionPage>;
  get(id: number): Promise<Row>;
  summary(range: Range, signal?: AbortSignal): Promise<Summary>;
  update(items: Array<Update & {addTags?: number[]}>): Promise<Row[]>;
}

const categoryAliases: Record<string, string[]> = {
  'dining out': ['restaurants', 'eating out'],
  restaurants: ['dining out', 'eating out'],
};
export const uncategorized = {id: '0', label: 'Uncategorized', aliases: ['no category']};
export const cash = {id: 'cash', label: 'Cash'};

function tagColor(value?: string | null) {
  const hex = value?.trim().replace(/^#/, '') ?? '';
  return /^(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex) ? `#${hex}` : undefined;
}

function tagAccent(tag: Schema['tagObject']) {
  const text = tagColor(tag.text_color);
  const background = tagColor(tag.background_color);

  // Lunch Money represents its default swatch as light gray with dark gray text.
  if (
    (!background || /^#(?:eee|eeeeee)$/i.test(background)) &&
    (!text || /^#(?:333|333333)$/i.test(text))
  ) {
    return undefined;
  }

  return background ?? text;
}

export function liveSource(apiKey: string): DataSource {
  const client = new LunchMoneyClient({apiKey});
  // SDK methods inherit the abort signal from their client.
  const forRead = (signal?: AbortSignal) =>
    signal ? new LunchMoneyClient({apiKey, signal}) : client;

  return {
    async metadata(signal) {
      const read = forRead(signal);
      const [user, categories, tags, manual, plaid, settings] = await Promise.all([
        read.user.getMe(),
        read.categories.getAll({format: 'nested'}),
        read.tags.getAll(),
        read.manualAccounts.getAll(),
        read.plaidAccounts.getAll(),
        read.budgets.getSettings(),
      ]);
      const categoryChoice = (
        category: {id: number; name: string},
        groupLabel?: string,
      ): Choice => ({
        id: String(category.id),
        label: category.name,
        groupLabel,
        aliases: [
          ...(categoryAliases[category.name.toLowerCase()] ?? []),
          ...(groupLabel ? [groupLabel] : []),
        ],
      });
      return {
        currency: user.primary_currency,
        cadence: settings.budget_period_granularity,
        categories: [
          uncategorized,
          ...categories.flatMap(category => [
            {
              ...categoryChoice(category),
              group: category.is_group,
              members: category.children?.map(child => child.id),
            },
            ...(category.children ?? []).map(child =>
              categoryChoice(child, category.name),
            ),
          ]),
        ],
        tags: tags.map(tag => ({
          id: String(tag.id),
          label: tag.name,
          color: tagAccent(tag),
        })),
        accounts: [
          cash,
          ...manual.map(account => ({
            id: `manual:${account.id}`,
            label: account.display_name || account.name,
          })),
          ...plaid.map(account => ({
            id: `plaid:${account.id}`,
            label: account.display_name || account.name,
          })),
        ],
      };
    },
    async transactionsPage(range, offset, signal) {
      const limit = 1000;
      const {transactions, hasMore} = await forRead(signal).transactions.getAll({
        start_date: range.start,
        end_date: range.end,
        include_pending: false,
        limit,
        offset,
      });
      if (hasMore && !transactions.length) {
        throw new Error(
          'Lunch Money returned an empty page before the end of the date range.',
        );
      }
      return {rows: transactions, nextOffset: hasMore ? offset + limit : undefined};
    },
    get: id => client.transactions.get(id),
    summary: (range, signal) =>
      forRead(signal).summary.get({
        start_date: range.start,
        end_date: range.end,
        include_occurrences: true,
      }),
    async update(items) {
      function payload(item: Update & {addTags?: number[]}) {
        const {tag_ids, ...fields} = item.patch;
        return item.addTags
          ? {...fields, additional_tag_ids: item.addTags}
          : {...fields, ...(tag_ids === undefined ? {} : {tag_ids})};
      }

      if (items.length === 1) {
        const [item] = items;
        return [await client.transactions.update(item.id, payload(item))];
      }

      const {transactions} = await client.transactions.updateMany({
        transactions: items.map(item => ({id: item.id, ...payload(item)})),
      });
      return transactions;
    },
  };
}
