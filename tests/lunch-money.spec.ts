import {expect, test} from '@playwright/test';
import {monthRange, currentMonth} from '../src/api';
import {demoSource} from '../src/transactions';

test('loads a connected budget, handles API errors, and restores the connection after reload', async ({page}) => {
  const range = monthRange(currentMonth());
  const fixture = demoSource();
  const {rows: sample} = await fixture.transactionsPage(range, 0);
  const offsets: string[] = [];
  let attempts = 0;
  await page.route('https://api.lunchmoney.dev/v2/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.headers().authorization).toBe('Bearer test-only-token');
    const path = url.pathname.replace('/v2', '');
    const json = (body: unknown, status = 200) => route.fulfill({status, json: body, headers: {'access-control-allow-origin': '*'}});

    if (request.method() === 'PUT') {
      attempts++;
      expect(path).toBe('/transactions/1');
      expect(request.postDataJSON()).toEqual({category_id: 1});
      if (attempts === 1) return json({message: 'Fixture rejected the write'}, 400);
      return json({...sample[0], category_id: 1}, 201);
    }

    if (path === '/transactions') {
      const offset = url.searchParams.get('offset')!;
      offsets.push(offset);
      if (offset === '1000' && offsets.length === 2) return json({message: 'Fixture interrupted page two'}, 503);
      expect(url.searchParams.get('start_date')).toBe(range.start);
      expect(url.searchParams.get('end_date')).toBe(range.end);
      return offset === '0' ? json({transactions: sample.slice(0, 1), has_more: true})
        : json({transactions: sample.slice(1), has_more: false});
    }

    switch (path) {
      case '/me': return json({primary_currency: 'usd'});
      case '/categories': return json({categories: [{
        id: 10, name: 'Food', is_group: true, children: [{id: 1, name: 'Dining out'}, {id: 2, name: 'Groceries'}],
      }]});
      case '/tags': return json({tags: [{id: 1, name: 'Travel'}, {id: 2, name: 'Work'}]});
      case '/manual_accounts': return json({manual_accounts: [{id: 1, name: 'Checking'}]});
      case '/plaid_accounts': return json({plaid_accounts: [{id: 2, name: 'Credit card'}]});
      case '/budgets/settings': return json({budget_period_granularity: 'month'});
      case '/summary': {
        const summary = await fixture.summary(range);
        return json({...summary, categories: [...summary.categories, {
          category_id: 10,
          totals: {budgeted: 600, other_activity: 50, recurring_activity: 0, recurring_remaining: 0, recurring_expected: 0},
        }]});
      }
      default: return route.abort();
    }
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Connect Lunch Money'}).click();
  await page.getByLabel('Lunch Money API token').fill('test-only-token');
  await page.getByRole('button', {name: 'Connect', exact: true}).click();
  await expect(page.getByText('Lunch Money', {exact: true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Fixture interrupted page two');
  await page.getByRole('button', {name: 'Retry transactions'}).click();
  await expect(page.locator('[data-row-id="12"]')).toBeVisible();
  expect(offsets).toEqual(['0', '1000', '1000']);
  const food = page.getByRole('complementary').locator('details').filter({hasText: 'Food'});
  await expect(food.getByRole('meter', {name: 'Food budget used'})).toHaveAttribute('max', '600');
  await expect(food.getByRole('meter', {name: 'Groceries budget used'})).toBeVisible();
  const first = page.locator('[data-row-id="1"]');
  await first.focus();
  await page.keyboard.press('C');
  await page.getByRole('option', {name: 'Dining out', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Fixture rejected the write');
  await expect(first).toContainText('Uncategorized');
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toHaveCount(0);
  await first.focus();
  await page.keyboard.press('C');
  await page.getByRole('option', {name: 'Dining out', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeVisible();
  await expect(first).toContainText('Dining out');
  expect(attempts).toBe(2);

  await page.reload();
  await expect(page.getByText('Lunch Money', {exact: true})).toBeVisible();
  await expect(page.locator('[data-row-id="12"]')).toBeVisible();
  expect(offsets.slice(-2)).toEqual(['0', '1000']);

  await page.getByRole('button', {name: 'Connection', exact: true}).click();
  await page.getByRole('button', {name: 'Disconnect', exact: true}).click();
  await expect(page.getByText('Sample data', {exact: true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('Sample data', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Connect Lunch Money'})).toBeVisible();
});
