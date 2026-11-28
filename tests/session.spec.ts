import {expect, test} from '@playwright/test';

import {currentMonth, monthRange, shiftMonth} from '../src/data/api';
import {demoSource} from '../src/data/demo';
import {draftChange} from '../src/data/editChanges';
import {projectedHistory, projectRows} from '../src/data/editQueue';
import {createSession, type Session} from '../src/data/session';

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

async function settled({edits}: Session) {
  await expect.poll(() => edits.getState().phase.kind).toBe('idle');
  return edits.getState();
}

test('pending edits appear only in the queue projection until confirmed', async () => {
  const {source, session, page} = await loadSession();
  const row = page.rows[0];
  const gate = Promise.withResolvers<void>();
  const update = source.update;
  source.update = async changes => {
    await gate.promise;
    return update(changes);
  };

  session.edits.save({
    label: 'Changed note',
    changes: [draftChange(row, {notes: 'Pending note'})!],
  });
  const {phase, queued} = session.edits.getState();
  expect(session.rows.get(row.id)?.notes).toBe(row.notes);
  expect(projectRows(phase, queued, [row])[0].notes).toBe('Pending note');

  gate.resolve();
  await settled(session);
  expect(session.rows.get(row.id)?.notes).toBe('Pending note');
});

test('an undo conflict reconciles the row with Lunch Money', async () => {
  const {source, session, page} = await loadSession();
  const row = page.rows[0];
  session.edits.save({
    label: 'Changed note',
    changes: [draftChange(row, {notes: 'Local write'})!],
  });
  await settled(session);
  await source.update([{id: row.id, patch: {notes: 'External change'}}]);

  session.edits.replay('undo');
  const state = await settled(session);
  expect(state.issues).toEqual([{kind: 'conflict', id: row.id, fields: ['notes']}]);
  expect(session.rows.get(row.id)?.notes).toBe('External change');
});

test('a queued tag change preserves a tag added remotely while waiting', async () => {
  const {source, session, page} = await loadSession();
  const row = page.rows[0];
  const change = draftChange(row, {tag_ids: [1, 2]})!;
  await source.update([{id: row.id, patch: {tag_ids: [1, 3]}}]);

  session.edits.save({label: 'Set tags', changes: [change]});
  await settled(session);
  expect(session.rows.get(row.id)?.tag_ids).toEqual([1, 3, 2]);
  session.edits.replay('undo');
  await settled(session);
  expect(session.rows.get(row.id)?.tag_ids).toEqual([1, 3]);
});

test('an already-satisfied undo advances history with one read and no write', async () => {
  const {source, session, page} = await loadSession();
  const row = page.rows[0];
  session.edits.save({
    label: 'Changed note',
    changes: [draftChange(row, {notes: 'First edit'})!],
  });
  await settled(session);
  session.edits.save({
    label: 'Set tags',
    changes: [draftChange(row, {tag_ids: [1, 2]})!],
  });
  await settled(session);
  await source.update([{id: row.id, patch: {tag_ids: row.tag_ids}}]);
  const calls: string[] = [];
  const {get, update} = source;
  source.get = id => {
    calls.push('read');
    return get(id);
  };
  source.update = changes => {
    calls.push('write');
    return update(changes);
  };

  session.edits.replay('undo');
  const history = projectedHistory(await settled(session));
  expect(calls).toEqual(['read']);
  expect(history.undo.map(({edit}) => edit.label)).toEqual(['Changed note']);
  expect(
    history.redo.map(entry => (entry.kind === 'save' ? entry.entry : entry).edit.label),
  ).toEqual(['Set tags']);

  session.edits.replay('undo');
  await settled(session);
  expect(session.rows.get(row.id)?.notes ?? '').toBe('');
  expect(calls).toEqual(['read', 'read', 'write']);
});

test('a partially confirmed undo moves only the confirmed fields to redo', async () => {
  const {source, session, page} = await loadSession();
  const row = page.rows[0];
  const change = draftChange(row, {notes: 'New note', payee: 'New payee'})!;
  session.edits.save({label: 'Changed transaction', changes: [change]});
  await settled(session);

  const update = source.update;
  source.update = changes =>
    update(changes.map(({id, patch}) => ({id, patch: {notes: patch.notes}})));
  session.edits.replay('undo');
  const state = await settled(session);
  expect(state.issues).toContainEqual({
    kind: 'differentValue',
    id: row.id,
    fields: ['payee'],
  });
  expect(session.rows.get(row.id)).toMatchObject({notes: '', payee: 'New payee'});
  expect(state.history.undo[0].edit).toMatchObject({
    changes: [{after: {payee: 'New payee'}}],
  });
  expect(state.history.redo[0]).toMatchObject({
    edit: {changes: [{after: {notes: 'New note'}}]},
  });

  source.update = update;
  session.edits.replay('redo');
  await settled(session);
  expect(session.rows.get(row.id)).toMatchObject({notes: 'New note', payee: 'New payee'});
});

test('a mismatched transaction read stops undo without changing either row', async () => {
  const {source, session, page} = await loadSession();
  const [row, unrelated] = page.rows;
  session.edits.save({
    label: 'Changed note',
    changes: [draftChange(row, {notes: 'Saved note'})!],
  });
  await settled(session);

  await source.update([{id: unrelated.id, patch: {notes: 'Unrelated remote note'}}]);
  const get = source.get;
  source.get = id => get(id === row.id ? unrelated.id : id);
  session.edits.replay('undo');

  const state = await settled(session);
  expect(state.issues[0]).toEqual({kind: 'unavailable', id: row.id});
  expect(await get(row.id)).toMatchObject({notes: 'Saved note'});
  expect(session.rows.get(row.id)?.notes).toBe('Saved note');
  expect(session.rows.get(unrelated.id)?.notes).toBe(unrelated.notes);
  expect(projectedHistory(state).undo).toHaveLength(1);
});

test('a local cache failure keeps the confirmed write in undo history', async () => {
  const {source, session, page} = await loadSession();
  const [row] = page.rows;
  const update = session.rows.update;
  const error = new Error('Fixture interrupted cache update');
  session.rows.update = () => {
    session.rows.update = update;
    throw error;
  };

  session.edits.save({
    label: 'Changed note',
    changes: [draftChange(row, {notes: 'Saved note'})!],
  });
  const state = await settled(session);
  expect(state.issues).toEqual([{kind: 'cacheUpdateFailed', id: row.id, error}]);
  expect(await source.get(row.id)).toMatchObject({notes: 'Saved note'});
  expect(session.rows.get(row.id)?.notes).toBe('Saved note');
  expect(projectedHistory(state).undo).toHaveLength(1);

  session.edits.replay('undo');
  await settled(session);
  expect(session.rows.get(row.id)?.notes).toBe('');
});

async function expectSaved(session: Session) {
  const state = await settled(session);
  expect(state.issues).toEqual([]);
}

test('grouping waits for one batch of transaction reads before starting the next', async () => {
  const {source, session, page} = await loadSession();
  const previous = await source.transactionsPage(
    monthRange(shiftMonth(currentMonth(), -1)),
    0,
  );
  const ids = [...page.rows, ...previous.rows]
    .filter(row => !row.is_pending)
    .slice(0, 17)
    .map(row => row.id);
  const gate = Promise.withResolvers<void>();
  const reads: number[] = [];
  const {get} = source;
  source.get = async id => {
    reads.push(id);
    if (id === ids[0]) {
      await gate.promise;
    }

    return get(id);
  };

  session.edits.save({label: 'Grouped transactions', group: {kind: 'group', ids}});
  await expect.poll(() => reads).toEqual(ids.slice(0, 16));
  gate.resolve();
  await expectSaved(session);
  expect(reads).toEqual(ids);
  const group = [...session.rows.values()].find(row => row.is_group_parent);
  expect(group?.children?.map(row => row.id)).toEqual(ids);
});

test('grouping shares history with field edits and redo can recreate a new parent', async () => {
  const {source, session, page} = await loadSession();
  const [first, second] = page.rows;
  session.edits.save({
    label: 'Changed note',
    changes: [draftChange(first, {notes: 'Keep on the original transaction'})!],
  });
  session.edits.save({
    label: 'Grouped transactions',
    group: {kind: 'group', ids: [first.id, second.id]},
  });
  await expectSaved(session);

  const original = [...session.rows.values()].find(row => row.is_group_parent)!;
  expect(original).toMatchObject({
    date: first.date,
    payee: first.payee,
    amount: '14.6700',
    children: [{id: first.id}, {id: second.id}],
  });
  expect(session.rows.has(first.id)).toBe(false);
  expect(session.rows.has(second.id)).toBe(false);

  session.edits.replay('undo');
  await expectSaved(session);
  expect(session.rows.has(original.id)).toBe(false);
  expect(session.rows.get(first.id)?.notes).toBe('Keep on the original transaction');

  session.edits.replay('undo');
  await settled(session);
  expect(session.rows.get(first.id)?.notes).toBe(first.notes ?? '');

  session.edits.replay('redo');
  session.edits.replay('redo');
  await expectSaved(session);
  const recreated = [...session.rows.values()].find(row => row.is_group_parent)!;
  expect(recreated.id).not.toBe(original.id);
  const member = await source.get(first.id);
  expect(member).toMatchObject({
    group_parent_id: recreated.id,
    notes: 'Keep on the original transaction',
  });

  session.edits.replay('undo');
  await expectSaved(session);
  expect(session.rows.get(first.id)?.group_parent_id).toBeNull();
});

test('a group write that loses its response remains undoable after confirmation', async () => {
  const {source, session, page} = await loadSession();
  const ids = page.rows.slice(0, 2).map(row => row.id);
  const group = source.group;
  source.group = async input => {
    await group(input);
    throw new Error('Connection interrupted');
  };
  session.edits.save({label: 'Grouped transactions', group: {kind: 'group', ids}});
  const state = await settled(session);
  expect(state.issues).toContainEqual(expect.objectContaining({kind: 'requestFailed'}));
  expect(state.history.undo).toHaveLength(1);
  expect([...session.rows.values()].filter(row => row.is_group_parent)).toHaveLength(1);

  session.edits.replay('undo');
  await expectSaved(session);
  expect(ids.every(id => session.rows.get(id)?.group_parent_id === null)).toBe(true);
});
