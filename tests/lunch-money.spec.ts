import {expect, test} from '@playwright/test';
import {monthRange, currentMonth, type Patch} from '../src/api';
import {demoSource} from '../src/transactions';

test('loads a connected budget, handles API errors, and restores the connection after reload', async ({page}) => {
  const range = monthRange(currentMonth());
  const fixture = demoSource();
  const {rows: sample} = await fixture.transactionsPage(range, 0);
  sample[0] = {...sample[0], split_parent_id: 100};
  sample[1] = {...sample[1], split_parent_id: 100};
  sample[2] = {...sample[2], recurring_id: 200};
  const offsets: string[] = [];
  const selectionWrites: {path: string; body: unknown}[] = [];

  function applyPatch({id, ...patch}: {id: number} & Patch) {
    const index = sample.findIndex(row => row.id === id);
    expect(index).toBeGreaterThanOrEqual(0);
    sample[index] = {...sample[index], ...patch};
    return sample[index];
  }

  let attempts = 0;
  await page.route('https://api.lunchmoney.dev/v2/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.headers().authorization).toBe('Bearer test-only-token');
    const path = url.pathname.replace('/v2', '');
    const json = (body: unknown, status = 200) => route.fulfill({status, json: body, headers: {'access-control-allow-origin': '*'}});

    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      if (path === '/transactions/1') {
        attempts++;
        expect(body).toEqual({category_id: 1});
        if (attempts === 1) return json({message: 'Fixture rejected the write'}, 400);
        return json({...sample[0], category_id: 1});
      }

      selectionWrites.push({path, body});
      if (path === '/transactions/2') return json(applyPatch({id: 2, ...body}));
      if (path === '/transactions') return json({transactions: body.transactions.map(applyPatch)});
      return route.abort();
    }

    const transactionId = Number(path.split('/')[2]);
    if (path.startsWith('/transactions/') && transactionId >= 2 && transactionId <= 4) {
      return json(sample.find(row => row.id === transactionId));
    }

    if (path === '/transactions') {
      const offset = url.searchParams.get('offset')!;
      expect(url.searchParams.get('include_pending')).toBe('false');
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

  for (const [id, label] of [[2, 'Split transaction'], [3, 'Recurring transaction']] as const) {
    const amount = page.locator('[data-row-id="' + id + '"] [data-editor-cell=amount]');
    const icon = amount.getByRole('img', {name: label});
    await expect(icon).toBeVisible();
    const value = amount.getByText(/^\$/);
    expect((await icon.boundingBox())!.x).toBeLessThan((await value.boundingBox())!.x);
  }

  const food = page.getByRole('complementary').locator('details').filter({hasText: 'Food'});
  await expect(food.getByRole('meter', {name: 'Food budget used'})).toHaveAttribute('max', '600');
  await expect(food.getByRole('meter', {name: 'Groceries budget used'})).toBeVisible();
  const first = page.locator('[data-row-id="1"]');
  await first.focus();
  for (const [key, title] of [['C', 'Change category'], ['T', 'Set tags']]) {
    await page.keyboard.press(key);
    await expect(page.getByRole('dialog')).toHaveAccessibleName(title);
    await page.keyboard.press('Escape');
    await expect(first).toBeFocused();
  }
  expect(attempts).toBe(0);

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

  const selection = [2, 3, 4].map(id => page.locator('[data-row-id="' + id + '"]'));
  const categoryCells = selection.map(row => row.locator('[data-editor-cell=category]'));
  const originalCategories = await Promise.all(categoryCells.map(cell => cell.textContent()));
  await selection[0].focus();
  await page.keyboard.press('X');
  await page.keyboard.press('Shift+J');
  await page.keyboard.press('Shift+J');
  await page.keyboard.press('Control+k');
  const changeCategory = page.getByRole('option', {name: /Change category/});
  await expect(changeCategory).toContainText('3 transactions');
  await changeCategory.click();
  await page.getByRole('option', {name: 'Dining out', exact: true}).click();
  await expect(page.getByText('3 transactions saved', {exact: true})).toBeVisible();
  for (const cell of categoryCells) await expect(cell).toHaveText('Dining out');
  expect(selectionWrites).toEqual([
    {path: '/transactions/2', body: {category_id: 1}},
    {path: '/transactions', body: {transactions: [{id: 3, category_id: 1}, {id: 4, category_id: 1}]}},
  ]);

  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(page.getByText('Undo complete', {exact: true})).toBeVisible();
  expect(await Promise.all(categoryCells.map(cell => cell.textContent()))).toEqual(originalCategories);
  expect(selectionWrites.slice(2).map(write => write.path)).toEqual(['/transactions/2', '/transactions']);

  await page.getByRole('button', {name: 'Clear selection', exact: true}).click();
  const [split] = selection;
  await expect(page.locator('[data-row-id="8"]')).toHaveCount(0);
  await split.focus();
  await page.keyboard.press('R');
  await expect(page.getByText('Marked reviewed', {exact: true})).toBeVisible();
  await expect(split.getByRole('img', {name: 'Reviewed', exact: true})).toBeVisible();
  expect(selectionWrites.slice(4)).toEqual([{path: '/transactions/2', body: {status: 'reviewed'}}]);

  await split.focus();
  await page.keyboard.press('Control+k');
  await page.getByRole('option', {name: /Mark unreviewed/}).click();
  await expect(page.getByText('Marked unreviewed', {exact: true})).toBeVisible();
  await expect(split.getByRole('img', {name: 'Unreviewed', exact: true})).toBeVisible();
  expect(selectionWrites.at(-1)).toEqual({path: '/transactions/2', body: {status: 'unreviewed'}});

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
