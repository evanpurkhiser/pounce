import {expect, test, type Page} from '@playwright/test';

import {monthRange, currentMonth, type Patch} from '../src/data/api';
import {demoSource} from '../src/data/demo';

test('loads a connected budget, handles API errors, and restores the connection after reload', async ({
  page,
}) => {
  const range = monthRange(currentMonth());
  const fixture = demoSource();
  const {rows: sample} = await fixture.transactionsPage(range, 0);
  sample[0] = {...sample[0], split_parent_id: 100};
  sample[1] = {...sample[1], split_parent_id: 100};
  sample[2] = {...sample[2], recurring_id: 200, amount: '-1000.0000', to_base: -1000};
  sample[11] = {...sample[11], is_group_parent: true};
  const offsets: string[] = [];
  const selectionWrites: Array<{path: string; body: unknown}> = [];

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
    const json = (body: unknown, status = 200) =>
      route.fulfill({status, json: body, headers: {'access-control-allow-origin': '*'}});

    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      if (path === '/transactions/1') {
        attempts++;
        expect(body).toEqual({category_id: 1});
        if (attempts === 1) {
          return json(
            {
              message: 'Fixture rejected the write',
              errors: [{errMsg: 'Category unavailable'}],
            },
            400,
          );
        }
        return json({...sample[0], category_id: 1});
      }

      selectionWrites.push({path, body});
      if (path === '/transactions/2') {
        return json(applyPatch({id: 2, ...body}));
      }
      if (path === '/transactions') {
        return json({transactions: body.transactions.map(applyPatch)});
      }
      return route.abort();
    }

    const transactionId = Number(path.split('/')[2]);
    if (path.startsWith('/transactions/') && transactionId >= 1 && transactionId <= 4) {
      return json(sample.find(row => row.id === transactionId));
    }

    if (path === '/transactions') {
      const offset = url.searchParams.get('offset')!;
      expect(url.searchParams.get('include_pending')).toBe('false');
      offsets.push(offset);
      if (offset === '1000' && offsets.length === 2) {
        return json({message: 'Fixture interrupted page two'}, 503);
      }
      expect(url.searchParams.get('start_date')).toBe(range.start);
      expect(url.searchParams.get('end_date')).toBe(range.end);
      return offset === '0'
        ? json({transactions: sample.slice(0, 1), has_more: true})
        : json({transactions: sample.slice(1), has_more: false});
    }

    switch (path) {
      case '/me':
        return json({primary_currency: 'usd'});
      case '/categories':
        return json({
          categories: [
            {
              id: 10,
              name: 'Food',
              is_group: true,
              children: [
                {id: 1, name: 'Dining out'},
                {id: 2, name: 'Groceries'},
              ],
            },
          ],
        });
      case '/tags':
        return json({
          tags: [
            {id: 1, name: 'Travel', text_color: '15734E', background_color: 'CFF4F3'},
            {id: 2, name: 'Work', text_color: '333333', background_color: 'EEE'},
            {id: 3, name: 'Shared', text_color: '333', background_color: '#D7F5CC'},
          ],
        });
      case '/manual_accounts':
        return json({manual_accounts: [{id: 1, name: 'Checking'}]});
      case '/plaid_accounts':
        return json({plaid_accounts: [{id: 2, name: 'Credit card'}]});
      case '/budgets/settings':
        return json({budget_period_granularity: 'month'});
      case '/summary': {
        const summary = await fixture.summary(range);
        return json({
          ...summary,
          categories: [
            ...summary.categories,
            {
              category_id: 10,
              totals: {
                budgeted: 600,
                other_activity: 50,
                recurring_activity: 0,
                recurring_remaining: 0,
                recurring_expected: 0,
              },
            },
          ],
        });
      }
      default:
        return route.abort();
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

  await page.emulateMedia({colorScheme: 'light'});
  const credit = page.getByText('+$1,000.00', {exact: true});
  await expect(credit).toBeVisible();
  await expect(credit).toHaveCSS('color', 'rgb(33, 128, 68)');
  await expect(page.getByText('$10.52', {exact: true})).toBeVisible();

  const travelTag = page
    .locator('[data-row-id="1"] [data-editor-cell=tags]')
    .getByTitle('Travel');
  await expect(travelTag).toHaveCSS('color', /^oklch\(0\.49 /);
  const travelColor = await travelTag.evaluate(tag => getComputedStyle(tag).color);
  await expect(travelTag).toHaveCSS('border-top-color', travelColor);
  await expect(travelTag).toHaveCSS(
    'background-color',
    /^color\(srgb 0\.9\d+ 0\.9\d+ 0\.9\d+\)$/,
  );
  const workTag = page
    .locator('[data-row-id="2"] [data-editor-cell=tags]')
    .getByTitle('Work');
  await expect(workTag).toHaveCSS('color', 'rgb(105, 105, 105)');
  await expect(workTag).toHaveCSS('border-top-color', 'rgb(105, 105, 105)');
  await page.emulateMedia({colorScheme: 'dark'});
  await expect(credit).toHaveCSS('color', 'rgb(131, 216, 160)');
  await expect(travelTag).toHaveCSS('color', 'rgb(207, 244, 243)');
  await expect(travelTag).toHaveCSS('border-top-color', 'rgb(207, 244, 243)');
  await expect(travelTag).toHaveCSS(
    'background-color',
    /^color\(srgb 0\.2\d+ 0\.2\d+ 0\.2\d+\)$/,
  );
  await expect(
    page.locator('[data-row-id="3"] [data-editor-cell=tags]').getByTitle('Shared'),
  ).toHaveCSS('color', 'rgb(215, 245, 204)');
  await expect(workTag).toHaveCSS('color', 'rgb(184, 184, 184)');
  await expect(workTag).toHaveCSS('border-top-color', 'rgb(184, 184, 184)');
  await page.emulateMedia({colorScheme: null});

  for (const [id, label, formattedAmount] of [
    [2, 'Split transaction', '$10.52'],
    [3, 'Recurring transaction', '+$1,000.00'],
    [12, 'Transaction group', '$74.22'],
  ] as const) {
    const amount = page.locator(`[data-row-id="${id}"] [data-editor-cell=amount]`);
    const icon = amount.getByRole('img', {name: label});
    await expect(icon).toBeVisible();
    const value = amount.getByText(formattedAmount, {exact: true});
    expect((await icon.boundingBox())!.x).toBeLessThan((await value.boundingBox())!.x);
  }

  const food = page
    .getByRole('complementary')
    .locator('details')
    .filter({hasText: 'Food'});
  await expect(food.getByRole('meter', {name: 'Food budget used'})).toHaveAttribute(
    'max',
    '600',
  );
  await expect(food.getByRole('meter', {name: 'Groceries budget used'})).toBeVisible();
  const first = page.locator('[data-row-id="1"]');
  await first.focus();
  for (const [key, title] of [
    ['C', 'Change category'],
    ['T', 'Set tags'],
  ]) {
    await page.keyboard.press(key);
    await expect(page.getByRole('dialog')).toHaveAccessibleName(title);
    if (key === 'T') {
      const travel = page.getByRole('option', {name: 'Travel', exact: true});
      await expect(travel.getByTitle('Travel')).toHaveCSS('color', travelColor);
    }
    await page.keyboard.press('Escape');
    await expect(first).toBeFocused();
  }
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('Filter Tag Travel');
  const travelCommand = page.getByRole('option', {
    name: 'Filter › Tag › Travel',
    exact: true,
  });
  await expect(travelCommand.getByTitle('Travel')).toHaveCSS('color', travelColor);
  await page.keyboard.press('Escape');
  expect(attempts).toBe(0);

  await page.keyboard.press('C');
  await page.getByRole('option', {name: 'Dining out', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Fixture rejected the write');
  await expect(page.getByRole('alert')).toContainText('Category unavailable');
  await expect(first).toContainText('Uncategorized');
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toHaveCount(0);
  await first.focus();
  await page.keyboard.press('C');
  await page.getByRole('option', {name: 'Dining out', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeVisible();
  await expect(first).toContainText('Dining out');
  expect(attempts).toBe(2);

  const selection = [2, 3, 4].map(id => page.locator(`[data-row-id="${id}"]`));
  const categoryCells = selection.map(row => row.locator('[data-editor-cell=category]'));
  const originalCategories = await Promise.all(
    categoryCells.map(cell => cell.textContent()),
  );
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
  for (const cell of categoryCells) {
    await expect(cell).toHaveText('Dining out');
  }
  expect(selectionWrites).toEqual([
    {path: '/transactions/2', body: {category_id: 1}},
    {
      path: '/transactions',
      body: {
        transactions: [
          {id: 3, category_id: 1},
          {id: 4, category_id: 1},
        ],
      },
    },
  ]);

  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(page.getByText('Undo complete', {exact: true})).toBeVisible();
  expect(await Promise.all(categoryCells.map(cell => cell.textContent()))).toEqual(
    originalCategories,
  );
  expect(selectionWrites.slice(2).map(write => write.path)).toEqual([
    '/transactions/2',
    '/transactions',
  ]);

  await page.getByRole('button', {name: 'Clear selection', exact: true}).click();
  const [split] = selection;
  await expect(page.locator('[data-row-id="8"]')).toHaveCount(0);
  await split.focus();
  await page.keyboard.press('R');
  await expect(page.getByText('Marked reviewed', {exact: true})).toBeVisible();
  await expect(split.getByRole('img', {name: 'Reviewed', exact: true})).toBeVisible();
  expect(selectionWrites.slice(4)).toEqual([
    {path: '/transactions/2', body: {status: 'reviewed'}},
  ]);

  await split.focus();
  await page.keyboard.press('Control+k');
  await page.getByRole('option', {name: /Mark unreviewed/}).click();
  await expect(page.getByText('Marked unreviewed', {exact: true})).toBeVisible();
  await expect(split.getByRole('img', {name: 'Unreviewed', exact: true})).toBeVisible();
  expect(selectionWrites.at(-1)).toEqual({
    path: '/transactions/2',
    body: {status: 'unreviewed'},
  });

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

async function openWithPausedWrites(page: Page, failAt?: number) {
  const source = demoSource();
  const requests: string[] = [];
  const responses: Array<(value: void) => void> = [];
  await page.addInitScript(() =>
    localStorage.setItem('pounce.lunchMoneyToken', 'test-only-token'),
  );
  await page.route('https://api.lunchmoney.dev/v2/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/v2', '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({status, json: body, headers: {'access-control-allow-origin': '*'}});
    const range = monthRange(currentMonth());
    const id = Number(path.split('/')[2]);
    if (request.method() === 'PUT') {
      const patch: Patch = request.postDataJSON();
      const index = requests.push(patch.notes ?? '') - 1;
      await new Promise<void>(resolve => responses.push(resolve));
      if (index === failAt) {
        return json({message: 'Fixture rejected the queued edit'}, 400);
      }
      const [row] = await source.update([{id, patch}]);
      return json(row);
    }

    const metadata = new Map<string, object>(
      Object.entries({
        '/me': {primary_currency: 'usd'},
        '/categories': {categories: []},
        '/tags': {tags: []},
        '/manual_accounts': {manual_accounts: []},
        '/plaid_accounts': {plaid_accounts: []},
        '/budgets/settings': {budget_period_granularity: 'month'},
      }),
    );
    if (path === '/transactions') {
      const {rows} = await source.transactionsPage(range, 0);
      return json({transactions: rows, has_more: false});
    }
    if (id && path.startsWith('/transactions/')) {
      return json(await source.get(id));
    }
    if (path === '/summary') {
      return json(await source.summary(range));
    }
    const body = metadata.get(path);
    return body ? json(body) : route.abort();
  });
  await page.goto('/');
  const first = page.locator('[data-row-id="1"]');
  await expect(first).toBeVisible();
  const note = first.locator('[data-editor-cell=note]');
  return {
    requests,
    note,
    async changeNote(value: string) {
      await first.focus();
      await page.keyboard.press('N');
      await note.getByRole('textbox').fill(value);
      await note.getByRole('textbox').blur();
      await expect(note).toHaveText(value);
    },
    async finishWrite(index: number) {
      await expect.poll(() => responses.length).toBeGreaterThan(index);
      responses[index]();
    },
  };
}

test('undo and redo edit the queue before making another request', async ({page}) => {
  const {requests, note, changeNote, finishWrite} = await openWithPausedWrites(page);
  await changeNote('First note');
  await expect.poll(() => requests).toEqual(['First note']);
  await changeNote('Second note');
  await changeNote('Third note');

  await page.keyboard.press('Control+z');
  await expect(note).toHaveText('Second note');
  await page.keyboard.press('Control+z');
  await expect(note).toHaveText('First note');
  await page.keyboard.press('Control+Shift+z');
  await expect(note).toHaveText('Second note');
  expect(requests).toEqual(['First note']);

  await finishWrite(0);
  await expect.poll(() => requests).toEqual(['First note', 'Second note']);
  await expect(note).toHaveText('Second note');
  await finishWrite(1);

  const undo = page.getByRole('button', {name: 'Undo', exact: true});
  await undo.click();
  await expect.poll(() => requests).toEqual(['First note', 'Second note', 'First note']);
  await finishWrite(2);
  await expect(note).toHaveText('First note');
});

test('a rejected save discards the queue and keeps confirmed edits undoable', async ({
  page,
}) => {
  const {requests, note, changeNote, finishWrite} = await openWithPausedWrites(page, 1);
  await changeNote('Confirmed note');
  await changeNote('Rejected note');
  await changeNote('Discarded note');
  await finishWrite(0);
  await expect.poll(() => requests).toEqual(['Confirmed note', 'Rejected note']);
  await expect(note).toHaveText('Discarded note');

  await finishWrite(1);
  await expect(page.getByRole('alert')).toContainText('Fixture rejected the queued edit');
  await expect(page.getByRole('alert')).toContainText('1 queued edit was discarded');
  await expect(note).toHaveText('Confirmed note');

  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect.poll(() => requests).toEqual(['Confirmed note', 'Rejected note', '']);
  await finishWrite(2);
  await expect(note).toBeEmpty();
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toHaveCount(0);
});

test('rapid undo and redo queue reverse writes in order', async ({page}) => {
  const {requests, note, changeNote, finishWrite} = await openWithPausedWrites(page);
  const values = ['First note', 'Second note', 'Third note'];
  for (const [index, value] of values.entries()) {
    await changeNote(value);
    await finishWrite(index);
    await expect(page.getByText('Saving…', {exact: true})).toBeHidden();
  }

  for (const value of ['Second note', 'First note', '']) {
    await page.keyboard.press('Control+z');
    await expect(note).toHaveText(value);
  }
  await expect.poll(() => requests).toEqual([...values, 'Second note']);
  for (const index of [3, 4, 5]) {
    await finishWrite(index);
  }
  await expect(page.getByText('Saving…', {exact: true})).toBeHidden();
  expect(requests).toEqual([...values, 'Second note', 'First note', '']);

  for (const value of values) {
    await page.keyboard.press('Control+Shift+z');
    await expect(note).toHaveText(value);
  }
  await expect
    .poll(() => requests)
    .toEqual([...values, 'Second note', 'First note', '', 'First note']);
  for (const index of [6, 7, 8]) {
    await finishWrite(index);
  }
  await expect(page.getByText('Saving…', {exact: true})).toBeHidden();
  expect(requests).toEqual([...values, 'Second note', 'First note', '', ...values]);
});

test('undo queues behind a save already in flight after canceling newer drafts', async ({
  page,
}) => {
  const {requests, note, changeNote, finishWrite} = await openWithPausedWrites(page);
  await changeNote('In flight');
  await expect.poll(() => requests).toEqual(['In flight']);
  await changeNote('First draft');
  await changeNote('Second draft');

  for (const value of ['First draft', 'In flight', '']) {
    await page.keyboard.press('Control+z');
    await expect(note).toHaveText(value);
  }
  expect(requests).toEqual(['In flight']);

  await finishWrite(0);
  await expect.poll(() => requests).toEqual(['In flight', '']);
  await page.keyboard.press('Control+Shift+z');
  await expect(note).toHaveText('In flight');
  expect(requests).toEqual(['In flight', '']);

  await finishWrite(1);
  await expect.poll(() => requests).toEqual(['In flight', '', 'In flight']);
  await finishWrite(2);
  await expect(page.getByText('Saving…', {exact: true})).toBeHidden();
  await expect(note).toHaveText('In flight');

  await page.keyboard.press('Control+Shift+z');
  await expect(note).toHaveText('First draft');
  await finishWrite(3);
  await expect(page.getByText('Saving…', {exact: true})).toBeHidden();
  expect(requests).toEqual(['In flight', '', 'In flight', 'First draft']);
});

test('undo of an in-flight save is discarded if the original write fails', async ({
  page,
}) => {
  const {requests, note, changeNote, finishWrite} = await openWithPausedWrites(page, 0);
  await changeNote('In flight');
  await expect.poll(() => requests).toEqual(['In flight']);
  await page.keyboard.press('Control+z');
  await expect(note).toBeEmpty();

  await finishWrite(0);
  await expect(page.getByRole('alert')).toContainText('1 queued edit was discarded');
  await expect(page.getByText('Saving…', {exact: true})).toBeHidden();
  await expect(note).toBeEmpty();
  await expect(page.getByRole('button', {name: 'Redo', exact: true})).toHaveCount(0);
  expect(requests).toEqual(['In flight']);
});
