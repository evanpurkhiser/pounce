import type {components} from '@lunch-money/lunch-money-js-v2';
import {getLocalTimeZone, parseDate, today} from '@internationalized/date';

type Schema = components['schemas'];
export type Row = Schema['transactionObject'];
export type Patch = Partial<Pick<Row, 'payee' | 'date' | 'category_id' | 'tag_ids' | 'notes'>> & {status?: 'reviewed' | 'unreviewed'};
export type Update = {id: number; patch: Patch};
export type Range = {start: string; end: string};
export type Choice = {id: string; label: string; aliases?: string[]; group?: boolean; members?: number[]};
export type Metadata = {categories: Choice[]; tags: Choice[]; accounts: Choice[]; currency: string; cadence: string};
export type Summary = Schema['summaryResponseObject'];

export const currentMonth = () => today(getLocalTimeZone()).toString().slice(0, 7);
export const shiftMonth = (month: string, months: number) => parseDate(month + '-01').add({months}).toString().slice(0, 7);
export function monthRange(month: string): Range {
  const first = parseDate(month + '-01');
  return {start: first.toString(), end: first.add({months: 1}).subtract({days: 1}).toString()};
}
export const inRange = (date: string, range: Range) => date >= range.start && date <= range.end;
export const monthLabel = (month: string) => new Date(month + '-01T00:00:00Z').toLocaleDateString(undefined, {
  timeZone: 'UTC', month: 'long', year: 'numeric',
});
export function money(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'narrowSymbol'}).format(amount);
}
export const accountKey = (row: Row) => row.manual_account_id ? 'manual:' + row.manual_account_id : row.plaid_account_id ? 'plaid:' + row.plaid_account_id : 'cash';
export const canEdit = (row: Row) => !row.is_split_parent && row.split_parent_id == null && !row.is_group_parent && row.group_parent_id == null;
export const canReview = (row: Row) => canEdit(row) && !row.is_pending && row.status !== 'delete_pending';

export interface DataSource {
  metadata(signal?: AbortSignal): Promise<Metadata>;
  list(range: Range, signal?: AbortSignal): Promise<Row[]>;
  get(id: number): Promise<Row>;
  summary(range: Range, signal?: AbortSignal): Promise<Summary>;
  update(items: (Update & {addTags?: number[]})[]): Promise<Row[]>;
}

const categoryAliases: Record<string, string[]> = {
  'dining out': ['restaurants', 'eating out'],
  'restaurants': ['dining out', 'eating out'],
};
export const uncategorized = {id: '0', label: 'Uncategorized', aliases: ['no category']};
export const cash = {id: 'cash', label: 'Cash'};

export function liveSource(token: string): DataSource {
  async function request<T>(path: string, options?: {signal?: AbortSignal; body?: unknown}) {
    const response = await fetch('https://api.lunchmoney.dev/v2' + path, {
      method: options?.body ? 'PUT' : 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        ...(options?.body ? {'Content-Type': 'application/json'} : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: options?.signal,
    });
    if (!response.ok) {
      const error: unknown = await response.json().catch(() => undefined);
      const message = typeof error === 'object' && error && 'message' in error && typeof error.message === 'string'
        ? error.message : response.statusText;
      const detail = typeof error === 'object' && error && 'errors' in error && Array.isArray(error.errors)
        ? error.errors.flatMap(item => typeof item?.errMsg === 'string' ? [item.errMsg] : []).join(' ') : '';
      throw new Error(['Lunch Money returned ' + response.status, message, detail].filter(Boolean).join('. '));
    }
    return await response.json() as T;
  }

  return {
    async metadata(signal) {
      const options = {signal};
      const [user, categories, tags, manual, plaid, settings] = await Promise.all([
        request<{primary_currency: string}>('/me', options),
        request<{categories: {id: number; name: string; is_group: boolean; children?: {id: number; name: string}[]}[]}>('/categories?format=nested', options),
        request<{tags: {id: number; name: string}[]}>('/tags', options),
        request<{manual_accounts: {id: number; name: string; display_name?: string | null}[]}>('/manual_accounts', options),
        request<{plaid_accounts: {id: number; name: string; display_name?: string | null}[]}>('/plaid_accounts', options),
        request<{budget_period_granularity: string}>('/budgets/settings', options),
      ]);
      const categoryChoice = (category: {id: number; name: string}): Choice =>
        ({id: String(category.id), label: category.name, aliases: categoryAliases[category.name.toLowerCase()]});
      return {
        currency: user.primary_currency,
        cadence: settings.budget_period_granularity,
        categories: [uncategorized, ...categories.categories.flatMap(category => [
          {...categoryChoice(category), group: category.is_group, members: category.children?.map(child => child.id)},
          ...(category.children ?? []).map(categoryChoice),
        ])],
        tags: tags.tags.map(tag => ({id: String(tag.id), label: tag.name})),
        accounts: [
          cash,
          ...manual.manual_accounts.map(account => ({id: 'manual:' + account.id, label: account.display_name || account.name})),
          ...plaid.plaid_accounts.map(account => ({id: 'plaid:' + account.id, label: account.display_name || account.name})),
        ],
      };
    },
    async list(range, signal) {
      const limit = 1000;
      const rows = new Map<number, Row>();
      for (let offset = 0; ; offset += limit) {
        const query = new URLSearchParams({start_date: range.start, end_date: range.end, include_pending: 'true', limit: String(limit), offset: String(offset)});
        const result = await request<{transactions: Row[]; has_more: boolean}>('/transactions?' + query, {signal});
        for (const row of result.transactions) rows.set(row.id, row);
        if (!result.has_more) return [...rows.values()];
        if (!result.transactions.length) throw new Error('Lunch Money returned an empty page before the end of the date range.');
      }
    },
    get: id => request<Row>('/transactions/' + id),
    summary: (range, signal) => request<Summary>('/summary?' + new URLSearchParams({
      start_date: range.start, end_date: range.end, include_occurrences: 'true',
    }), {signal}),
    async update(items) {
      function payload(item: Update & {addTags?: number[]}) {
        const {tag_ids, ...fields} = item.patch;
        return item.addTags
          ? {...fields, additional_tag_ids: item.addTags}
          : {...fields, ...(tag_ids === undefined ? {} : {tag_ids})};
      }

      if (items.length === 1) {
        const [item] = items;
        return [await request<Row>('/transactions/' + item.id, {body: payload(item)})];
      }

      const {transactions} = await request<{transactions: Row[]}>('/transactions', {
        body: {transactions: items.map(item => ({id: item.id, ...payload(item)}))},
      });
      return transactions;
    },
  };
}
