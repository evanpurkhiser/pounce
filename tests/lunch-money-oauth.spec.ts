import {expect, test, type Page} from '@playwright/test';

import {createHash} from 'node:crypto';

import {currentMonth, monthRange} from '../src/data/api';
import {demoSource} from '../src/data/demo';

import {clientId, connectionKey, discoveryDocument, issuer} from './lunch-money-fixture';

const accessToken = 'mock-oauth-access-token';

test.skip(!clientId, 'External OAuth test builds must supply the test client ID.');

async function authorize(page: Page) {
  await page.route(`${issuer}/.well-known/oauth-authorization-server`, route =>
    route.fulfill({json: discoveryDocument}),
  );
  await page.route(`${issuer}/oauth/authorize?*`, route =>
    route.fulfill({contentType: 'text/plain', body: 'Lunch Money authorization'}),
  );

  await page.goto('/');
  const home = page.url();
  await page.getByRole('button', {name: 'Connect Lunch Money'}).click();
  await page.getByRole('button', {name: 'Authorize with Lunch Money'}).click();
  await page.waitForURL(`${issuer}/oauth/authorize?*`);

  const authorization = new URL(page.url()).searchParams;
  expect(authorization.get('client_id')).toBe(clientId);
  expect(authorization.get('redirect_uri')).toBe(home);
  expect(authorization.get('response_type')).toBe('code');
  expect(authorization.get('code_challenge_method')).toBe('S256');
  expect(authorization.has('scope')).toBe(false);
  const state = authorization.get('state');
  expect(state).toBeTruthy();

  const callback = new URL(home);
  callback.search = new URLSearchParams({
    code: 'mock-code',
    state: state!,
    iss: issuer,
  }).toString();
  return {callback, home, authorization};
}

test('restores the authorized budget after reload and revokes on disconnect', async ({
  page,
}) => {
  const {callback, home, authorization} = await authorize(page);
  await page.route(`${issuer}/oauth/token`, route => {
    const request = route.request();
    const form = new URLSearchParams(request.postData() ?? '');
    expect(request.method()).toBe('POST');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('mock-code');
    expect(form.get('redirect_uri')).toBe(home);
    expect(form.get('client_id')).toBe(clientId);
    expect(request.headers().authorization).toBeUndefined();
    expect(form.has('client_secret')).toBe(false);
    expect(
      createHash('sha256').update(form.get('code_verifier')!).digest('base64url'),
    ).toBe(authorization.get('code_challenge'));
    return route.fulfill({
      json: {access_token: accessToken, token_type: 'Bearer', expires_in: 3600},
    });
  });

  const data: Record<string, unknown> = {
    '/v2/me': {
      id: 1,
      account_id: 2,
      budget_name: 'Alpha test budget',
      primary_currency: 'usd',
    },
    '/v2/categories': {categories: []},
    '/v2/tags': {tags: []},
    '/v2/manual_accounts': {manual_accounts: []},
    '/v2/plaid_accounts': {plaid_accounts: []},
    '/v2/budgets/settings': {budget_period_granularity: 'month'},
    '/v2/summary': await demoSource().summary(monthRange(currentMonth())),
    '/v2/transactions': {transactions: [], has_more: false},
  };
  let identified = false;
  await page.route(`${issuer}/v2/**`, route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`);
    const path = new URL(route.request().url()).pathname;
    if (path === '/v2/me') {
      identified = true;
    }
    expect(identified).toBe(true);
    return route.fulfill({json: data[path] ?? {}, status: data[path] ? 200 : 404});
  });

  const transactions = page.waitForResponse(response =>
    response.url().startsWith(`${issuer}/v2/transactions?`),
  );
  await page.goto(callback.href);
  const transactionPage = await transactions;
  expect(transactionPage.ok()).toBe(true);
  await expect(page.getByRole('button', {name: 'Connection', exact: true})).toBeVisible();
  await expect(page).toHaveURL(home);

  const restoredTransactions = page.waitForResponse(response =>
    response.url().startsWith(`${issuer}/v2/transactions?`),
  );
  await page.reload();
  const restoredTransactionPage = await restoredTransactions;
  expect(restoredTransactionPage.ok()).toBe(true);

  await page.route(`${issuer}/oauth/revoke`, route => {
    const form = new URLSearchParams(route.request().postData() ?? '');
    expect(form.get('client_id')).toBe(clientId);
    expect(form.get('token')).toBe(accessToken);
    expect(form.get('token_type_hint')).toBe('access_token');
    return route.fulfill({status: 200, body: ''});
  });
  await page.getByRole('button', {name: 'Connection', exact: true}).click();
  await expect(page.getByText('Connected to Alpha test budget.')).toBeVisible();
  const revoked = page.waitForResponse(`${issuer}/oauth/revoke`);
  await page.getByRole('button', {name: 'Disconnect'}).click();
  const revocation = await revoked;
  expect(revocation.ok()).toBe(true);
  await expect(page.getByRole('button', {name: 'Connect Lunch Money'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', {name: 'Connect Lunch Money'})).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), connectionKey)).toBeNull();
});

test('clears a saved OAuth connection that expired while Pounce was closed', async ({
  page,
}) => {
  await page.addInitScript(
    ({key, accessToken}) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          accessToken,
          budgetName: 'Alpha test budget',
          expiresAt: Date.now() - 1,
        }),
      );
    },
    {key: connectionKey, accessToken},
  );

  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Connect Lunch Money'})).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), connectionKey)).toBeNull();
});

for (const parameter of ['state', 'iss'] as const) {
  test(`rejects a mismatched ${parameter} and consumes the attempt`, async ({page}) => {
    const {callback, home} = await authorize(page);
    let exchanges = 0;
    await page.route(`${issuer}/oauth/token`, route => {
      exchanges++;
      return route.abort();
    });

    const invalid = new URL(callback);
    invalid.searchParams.set(parameter, 'unexpected');
    for (const url of [invalid, callback]) {
      await page.goto(url.href);
      await expect(
        page.getByText('Could not finish the Lunch Money authorization.', {exact: false}),
      ).toBeVisible();
      await expect(page).toHaveURL(home);
    }
    expect(exchanges).toBe(0);
  });
}

test('rejects an OAuth budget response without a valid account identity', async ({
  page,
}) => {
  const {callback, home} = await authorize(page);
  await page.route(`${issuer}/oauth/token`, route =>
    route.fulfill({
      json: {access_token: accessToken, token_type: 'Bearer', expires_in: 3600},
    }),
  );
  await page.route(`${issuer}/v2/me`, route =>
    route.fulfill({json: {id: 1, account_id: '2', budget_name: 'Alpha test budget'}}),
  );

  await page.goto(callback.href);
  await expect(
    page.getByText(/Could not finish the Lunch Money authorization/),
  ).toBeVisible();
  await expect(page.getByRole('button', {name: 'Connect Lunch Money'})).toBeVisible();
  await expect(page).toHaveURL(home);
});
