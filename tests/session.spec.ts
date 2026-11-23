import {expect, test} from '@playwright/test';

import {currentMonth, monthRange} from '../src/api';
import {createSession} from '../src/data';
import {demoSource} from '../src/transactions';

async function loadSession() {
  const source = demoSource();
  const session = createSession(source);
  const range = monthRange(currentMonth());
  const signal = new AbortController().signal;
  const page = await session.loadPage(range, 0, signal);
  expect(session.applyPages(range, [page])).toBe(true);
  return {source, session, range, signal, page};
}

test('rejects an older snapshot when it overlaps a newer applied range', async () => {
  const {source, session, range, signal, page} = await loadSession();
  const rowRange = {start: page.rows[0].date, end: page.rows[0].date};
  const id = page.rows[0].id;
  await source.update([{id, patch: {notes: 'External change'}}]);
  const newer = await session.loadPage(rowRange, 0, signal);
  expect(session.applyPages(rowRange, [newer])).toBe(true);

  expect(session.applyPages(range, [page])).toBe(false);
  expect(session.rows.get(id)?.notes).toBe('External change');

  const refreshed = await session.loadPage(range, 0, signal);
  expect(session.applyPages(range, [refreshed])).toBe(true);
  expect(session.rows.get(id)?.notes).toBe('External change');
});

test('an undo conflict reconciles the row with Lunch Money', async () => {
  const {source, session, page} = await loadSession();
  const id = page.rows[0].id;
  const {edit} = await session.write('Changed note', async () => [
    {id, patch: {notes: 'Local write'}},
  ]);
  await source.update([{id, patch: {notes: 'External change'}}]);

  await expect(session.replay(edit, 'undo')).rejects.toThrow(
    `Transaction #${id} changed in Lunch Money (notes).`,
  );
  expect(session.rows.get(id)?.notes).toBe('External change');
});
