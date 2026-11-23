import {expect, test, type Page} from '@playwright/test';
import {currentMonth, shiftMonth} from '../src/api';

const row = (page: Page, id: number) => page.locator('[data-row-id="' + id + '"]');
const selection = (page: Page) => page.locator('[data-row-id][aria-selected=true]');
const dialog = (page: Page) => page.getByRole('dialog');

async function ready(page: Page) {
  await page.goto('/');
  await expect(row(page, 1)).toBeVisible();
}

async function pickCategory(page: Page, query: string) {
  await dialog(page).getByRole('combobox').fill(query);
  await page.keyboard.press('Enter');
}

test('keyboard range shrinks to its anchor, reverses, and honors filtered select all', async ({page}) => {
  await ready(page);
  await row(page, 5).focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(selection(page)).toHaveCount(2);
  await expect(row(page, 5)).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 6)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Shift+K');
  await expect(selection(page)).toHaveCount(0);
  await page.keyboard.press('Shift+K');
  await expect(row(page, 4)).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 5)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+a');
  await expect(selection(page)).toHaveCount(11);

  await page.getByRole('button', {name: 'Commands'}).click();
  await dialog(page).getByRole('combobox').fill('filter resturaunts');
  await expect(dialog(page).getByRole('option', {name: 'Filter › Category › Food › Dining out'})).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(selection(page)).toHaveCount(2);
  await page.getByRole('button', {name: 'Remove filter Dining out'}).click();
  await expect(selection(page)).toHaveCount(2);
});

test('one selected row opens a searchable category dropdown at its cell', async ({page}) => {
  await ready(page);
  const selected = row(page, 1);
  const category = selected.locator('[data-editor-cell=category]');
  await selected.focus();
  await page.keyboard.press('X');
  await page.keyboard.press('J');
  await page.keyboard.press('C');

  const picker = page.getByRole('dialog', {name: 'Change category'});
  const search = picker.getByRole('combobox', {name: 'Search categories'});
  await expect(search).toBeFocused();
  await expect(category.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  await expect(picker).toBeVisible();
  const anchor = (await category.boundingBox())!;
  const popup = (await picker.boundingBox())!;
  expect(Math.abs(popup.x - anchor.x)).toBeLessThan(2);
  expect(Math.abs(popup.y - (anchor.y + anchor.height))).toBeLessThan(8);

  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute('aria-selected', 'true');

  await category.getByRole('button').click();
  await expect(search).toBeFocused();
  for (const prefix of ['re', 'res']) {
    await search.fill(prefix);
    await expect(picker.getByRole('option')).toHaveText(['□Dining out']);
  }
  await search.fill('resturaunts');
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(category).toHaveText('Dining out');
  await expect(selected).toBeFocused();
  await expect(row(page, 2).locator('[data-editor-cell=category]')).toHaveText('Groceries');
});

test('date and tags open at their cells for a single row', async ({page}) => {
  await ready(page);
  const target = row(page, 1);
  await target.focus();

  for (const [key, field, title] of [
    ['D', 'date', 'Set transaction date'],
    ['T', 'tags', 'Set tags'],
  ]) {
    await page.keyboard.press(key);
    const picker = page.getByRole('dialog', {name: title, exact: true});
    const cell = target.locator('[data-editor-cell="' + field + '"]');
    await expect(cell.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    await expect(picker).toBeVisible();
    await expect(picker.locator(':focus')).toHaveCount(1);

    const anchor = (await cell.boundingBox())!;
    const popup = (await picker.boundingBox())!;
    expect(Math.abs(popup.x - anchor.x)).toBeLessThan(2);
    expect(Math.abs(popup.y - (anchor.y + anchor.height))).toBeLessThan(8);

    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(target).toBeFocused();
  }
});

test('editable cells and selection respond to clicks in the cell padding', async ({page}) => {
  await ready(page);
  const target = row(page, 1);

  for (const [field, label] of [
    ['date', 'Set transaction date'],
    ['category', 'Change category'],
    ['tags', 'Set tags'],
  ]) {
    const cell = target.locator('[data-editor-cell="' + field + '"]');
    await cell.click({position: {x: 2, y: 2}});
    await expect(dialog(page)).toHaveAccessibleName(label);
    await page.keyboard.press('Escape');
  }

  for (const [field, role, name] of [
    ['payee', 'combobox', 'Payee'],
    ['note', 'textbox', 'Note'],
  ] as const) {
    const cell = target.locator('[data-editor-cell="' + field + '"]');
    const bounds = (await cell.boundingBox())!;
    await cell.click({position: {x: bounds.width - 3, y: bounds.height - 3}});
    const editor = cell.getByRole(role, {name});
    await expect(editor).toBeFocused();
    const editorBounds = (await editor.boundingBox())!;
    const editingCell = (await cell.boundingBox())!;
    expect(Math.abs(editorBounds.x - editingCell.x)).toBeLessThan(1);
    expect(Math.abs(editorBounds.width - editingCell.width)).toBeLessThan(1);
    await page.keyboard.press('Escape');
  }

  const selector = target.locator('[data-editor-cell=selection]');
  await selector.click({position: {x: 2, y: 2}});
  await expect(target).toHaveAttribute('aria-selected', 'true');
});

test('the inline note editor keeps the row height and vertical centering', async ({page}) => {
  await ready(page);
  const target = row(page, 1);
  const checkbox = target.locator('.grid-checkbox');
  const idle = (await target.boundingBox())!;

  await target.focus();
  await page.keyboard.press('N');
  const editor = target.getByRole('textbox', {name: 'Note'});
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAttribute('rows', '1');
  await expect(editor).toHaveCSS('resize', 'none');
  await editor.fill('First line\nSecond line');
  const editing = (await target.boundingBox())!;
  const mark = (await checkbox.boundingBox())!;

  expect(editing.height).toBe(idle.height);
  expect(Math.abs((mark.y + mark.height / 2) - (editing.y + editing.height / 2))).toBeLessThan(1);
});

test('long transaction text stays on one line in shared column tracks', async ({page}) => {
  await page.setViewportSize({width: 1050, height: 800});
  await ready(page);
  const grid = page.getByRole('grid', {name: 'Transactions'});
  const target = row(page, 1);
  const width = (await grid.boundingBox())!.width;
  const height = (await target.boundingBox())!.height;
  const longText = 'A long field value '.repeat(16).trim();

  for (const [key, field, role, label] of [
    ['P', 'payee', 'combobox', 'Payee'],
    ['N', 'note', 'textbox', 'Note'],
  ] as const) {
    await target.focus();
    await page.keyboard.press(key);
    await target.getByRole(role, {name: label}).fill(longText);
    await page.getByRole('button', {name: /^Commands/}).focus();

    const text = target.locator('[data-editor-cell=' + field + '] .cell-action > span');
    await expect(text).toHaveText(longText);
    await expect(text).toHaveCSS('white-space', 'nowrap');
    await expect(text).toHaveCSS('text-overflow', 'ellipsis');
    expect(await text.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  }

  expect((await grid.boundingBox())!.width).toBe(width);
  expect((await target.boundingBox())!.height).toBe(height);
  const columns = await grid.evaluate(table => {
    const positions = (row: HTMLTableRowElement) => Array.from(row.cells, cell => {
      const {left, width} = cell.getBoundingClientRect();
      return [left, width];
    });
    const element = table as HTMLTableElement;
    return {header: positions(element.tHead!.rows[0]), data: positions(element.tBodies[0].rows[0])};
  });
  expect(columns.data).toEqual(columns.header);
});

test('bulk category replaces mixed values with one choice and supports undo and redo', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('X');
  await page.keyboard.press('J');
  await page.keyboard.press('X');
  await page.keyboard.press('C');
  await expect(dialog(page).getByRole('option', {name: /Uncategorized.*1 of 2/})).toBeVisible();
  await expect(dialog(page).getByRole('option', {name: /Groceries.*1 of 2/})).toBeVisible();
  await pickCategory(page, 'resturaunts');
  await expect(row(page, 1)).toContainText('Dining out');
  await expect(row(page, 2)).toContainText('Dining out');
  await expect(row(page, 2)).toBeFocused();
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(row(page, 1)).toContainText('Uncategorized');
  await expect(row(page, 2)).toContainText('Groceries');
  await expect(page.getByRole('button', {name: 'Redo', exact: true})).toBeEnabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(row(page, 1)).toContainText('Dining out');
});

test('bulk tag picker keeps mixed memberships until Apply and preserves other tags', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('X');
  await page.keyboard.press('J');
  await page.keyboard.press('X');
  await page.keyboard.press('T');
  await expect(dialog(page).getByRole('option', {name: /Travel.*1 of 2/})).toBeVisible();
  await dialog(page).getByRole('combobox').fill('travel');
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByRole('button', {name: 'Apply tags'})).toBeEnabled();
  await expect(row(page, 2)).not.toContainText('Travel');
  await dialog(page).getByRole('button', {name: 'Apply tags'}).click();
  await expect(row(page, 2)).toContainText('Work, Travel');
  await expect(row(page, 1)).toContainText('Travel');
});

test('payee and note drafts save on blur and Escape discards a note draft', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('P');
  const payee = page.getByRole('combobox', {name: 'Payee'});
  await expect(payee).toBeFocused();
  expect(await payee.evaluate(input => (input as HTMLInputElement).selectionEnd)).toBe('MUD Coffee'.length);
  await page.keyboard.insertText('New merchant');
  await page.keyboard.press('Tab');
  await expect(row(page, 1)).toContainText('New merchant');
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();

  await row(page, 1).focus();
  await page.keyboard.press('N');
  const note = row(page, 1).locator('[data-editor-cell=note]').getByRole('textbox', {name: 'Note'});
  await expect(note).toBeFocused();
  await note.fill('discard this');
  await page.keyboard.press('Escape');
  await expect(note).toHaveCount(0);
  await expect(row(page, 1)).toBeFocused();

  await page.keyboard.press('N');
  await expect(note).toHaveValue('');
  await note.fill('Saved in the grid');
  const commands = page.getByRole('button', {name: /^Commands/});
  await commands.focus();
  await expect(row(page, 1).locator('[data-editor-cell=note]')).toHaveText('Saved in the grid');
  await expect(commands).toBeFocused();

  await row(page, 1).focus();
  await page.keyboard.press('N');
  await expect(note).toHaveValue('Saved in the grid');
  await note.clear();
  await page.keyboard.press('Tab');
  await expect(row(page, 1).locator('[data-editor-cell=note]')).toHaveText('No note');
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();

  await row(page, 1).focus();
  await page.keyboard.press('X');
  await page.keyboard.press('J');
  await page.keyboard.press('X');
  await page.keyboard.press('P');
  await expect(dialog(page)).toHaveAccessibleName('Set payee · 2 transactions');
  await page.keyboard.press('Escape');
  await page.keyboard.press('N');
  await expect(dialog(page)).toHaveAccessibleName('Replace notes · 2 transactions');
  await page.keyboard.press('Escape');
  await page.keyboard.press('D');
  await expect(dialog(page)).toHaveAccessibleName('Set transaction date · 2 transactions');
});

test('review filter offers the available changes to the current review status', async ({page}) => {
  await ready(page);
  const filter = page.getByRole('button', {name: 'Filter', exact: true});
  const reviewed = dialog(page).getByRole('option', {name: 'Reviewed', exact: true});
  const unreviewed = dialog(page).getByRole('option', {name: 'Unreviewed', exact: true});
  const anyStatus = dialog(page).getByRole('option', {name: 'Any review status', exact: true});

  await filter.click();
  await expect(reviewed).toBeVisible();
  await expect(anyStatus).toHaveCount(0);
  await unreviewed.click();

  await filter.click();
  await expect(unreviewed).toHaveCount(0);
  await expect(anyStatus).toBeVisible();
  await reviewed.click();

  await filter.click();
  await expect(reviewed).toHaveCount(0);
  await expect(unreviewed).toBeVisible();
  await anyStatus.click();

  await filter.click();
  await expect(anyStatus).toHaveCount(0);
  await expect(reviewed).toBeVisible();
  await expect(unreviewed).toBeVisible();
});

test('month sequences and review advance work with row focus', async ({page}) => {
  await ready(page);
  await page.getByRole('button', {name: 'Filter', exact: true}).click();
  await dialog(page).getByRole('option', {name: 'Unreviewed', exact: true}).click();
  await row(page, 1).focus();
  await page.keyboard.press('R');
  await expect(row(page, 1)).toHaveCount(0);
  await expect(row(page, 2)).toBeFocused();
  await page.keyboard.press('G');
  await page.keyboard.press('P');
  await expect(row(page, 101)).toBeVisible();
  await page.keyboard.press('G');
  await page.keyboard.press('M');
  await expect(dialog(page)).toHaveAccessibleName('Go to month');
  await dialog(page).getByRole('combobox').fill(currentMonth());
  await page.keyboard.press('Enter');
  await expect(row(page, 2)).toBeVisible();
  await expect(row(page, 1)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(row(page, 1)).toBeVisible();
});

test('bulk date change moves across months and can be undone from another month', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('X');
  await page.keyboard.press('J');
  await page.keyboard.press('X');
  await page.keyboard.press('D');
  const next = shiftMonth(currentMonth(), -1);
  const [year, month] = next.split('-');
  await dialog(page).getByRole('spinbutton', {name: /month/i}).press(month[0]);
  await page.keyboard.press(month[1]);
  await dialog(page).getByRole('spinbutton', {name: /day/i}).press('1');
  const yearInput = dialog(page).getByRole('spinbutton', {name: /year/i});
  await yearInput.focus();
  for (const digit of year) await page.keyboard.press(digit);
  await dialog(page).getByRole('button', {name: 'Apply date'}).click();
  await expect(row(page, 1)).toHaveCount(0);
  await expect(row(page, 2)).toHaveCount(0);
  await page.getByRole('button', {name: 'Previous month'}).click();
  await expect(row(page, 1)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(row(page, 1)).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Redo', exact: true})).toBeEnabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(row(page, 1)).toBeVisible();
});

test('shortcut overlay restores focus and filter modifier adds a second category', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('Shift+/');
  await expect(dialog(page)).toHaveAccessibleName('Keyboard shortcuts');
  await page.keyboard.press('Escape');
  await expect(row(page, 1)).toBeFocused();

  await page.getByRole('button', {name: 'Filter', exact: true}).click();
  await dialog(page).getByRole('option', {name: 'Category', exact: true}).click();
  const search = dialog(page).getByRole('combobox');
  await search.fill('groceries');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('button', {name: 'Remove filter Groceries', includeHidden: true})).toBeAttached();
  await search.fill('transportation');
  await page.keyboard.press('Control+Enter');
  await dialog(page).getByRole('button', {name: 'Done'}).click();
  await expect(row(page, 2)).toBeVisible();
  await expect(row(page, 3)).toBeVisible();
  await expect(row(page, 1)).toHaveCount(0);
});

test('column headers and the sort submenu share order and preserve selection', async ({page}) => {
  await ready(page);
  const headers = page.getByRole('columnheader');
  const date = page.getByRole('columnheader', {name: 'Date', exact: true});
  const amount = page.getByRole('columnheader', {name: 'Amount', exact: true});
  const review = page.getByRole('columnheader', {name: 'Review', exact: true});
  const displayed = page.locator('tbody tr[data-row-id]');
  await expect(headers).toHaveCount(8);
  await expect(headers).toHaveText(['✓', 'Date↓', 'Category↕', 'Payee↕', 'Amount↕', 'Note↕', 'Tags↕', 'Review']);
  await expect(date).toHaveAttribute('aria-sort', 'descending');
  await expect(review.locator('svg.lucide-check')).toBeVisible();
  await expect(row(page, 1).getByRole('img', {name: 'Unreviewed'}).locator('svg.lucide-circle')).toBeVisible();

  await row(page, 1).focus();
  await page.keyboard.press('X');
  await amount.click();
  await expect(amount).toHaveAttribute('aria-sort', 'ascending');
  await expect(displayed.first()).toHaveAttribute('data-row-id', '1');
  await amount.click();
  await expect(amount).toHaveAttribute('aria-sort', 'descending');
  await expect(displayed.first()).toHaveAttribute('data-row-id', '12');

  await row(page, 1).focus();
  await page.keyboard.press('S');
  await expect(dialog(page)).toHaveAccessibleName('Sort by');
  await dialog(page).getByRole('option', {name: 'Date Oldest first'}).click();
  await expect(date).toHaveAttribute('aria-sort', 'ascending');
  await expect(displayed.first()).toHaveAttribute('data-row-id', '12');
  await expect(row(page, 1)).toBeFocused();
  await expect(row(page, 1)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Control+k');
  await dialog(page).getByRole('option', {name: /^Sort by/}).click();
  await dialog(page).getByRole('option', {name: 'Date Newest first'}).click();
  await expect(date).toHaveAttribute('aria-sort', 'descending');
  await expect(displayed.first()).toHaveAttribute('data-row-id', '1');
  await expect(row(page, 9).getByRole('img', {name: 'Reviewed', exact: true})).toHaveAttribute('data-reviewed', 'true');
  await review.click();
  await expect(review).toHaveAttribute('aria-sort', 'ascending');
  await review.click();
  await expect(review).toHaveAttribute('aria-sort', 'descending');
});

test('clicking away saves the payee and leaves focus at its destination', async ({page}) => {
  await ready(page);
  const payee = page.getByRole('combobox', {name: 'Payee'});
  const commands = page.getByRole('button', {name: /^Commands/});
  await row(page, 1).focus();
  await page.keyboard.press('P');
  await payee.fill('New payee on click');
  await commands.click();
  await expect(dialog(page)).toHaveAccessibleName('Commands');
  await page.keyboard.press('Escape');
  await expect(commands).toBeFocused();
  await expect(payee).toHaveCount(0);
  await expect(row(page, 1)).toContainText('New payee on click');
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();

  await row(page, 1).focus();
  await page.keyboard.press('P');
  await payee.fill('Discard this payee');
  await page.keyboard.press('Escape');
  await expect(payee).toHaveCount(0);
  await expect(row(page, 1)).toContainText('New payee on click');
  await page.keyboard.press('J');
  await expect(row(page, 2)).toBeFocused();
});

test('bulk payee and note edits save when leaving the field', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('Shift+J');
  await page.keyboard.press('P');
  const payee = dialog(page).getByRole('combobox', {name: 'Payee'});
  await payee.fill('Joint payee');
  await page.keyboard.press('Tab');
  await expect(dialog(page)).toHaveCount(0);
  for (const id of [1, 2]) await expect(row(page, id)).toContainText('Joint payee');
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();

  await row(page, 2).focus();
  await page.keyboard.press('N');
  const note = dialog(page).getByRole('textbox', {name: 'Note'});
  await expect(note).toHaveAttribute('placeholder', 'Mixed notes');
  await note.fill('Joint note');
  await page.keyboard.press('Tab');
  await expect(dialog(page)).toHaveCount(0);
  for (const id of [1, 2]) await expect(row(page, id)).toContainText('Joint note');
});

test('posted rows are visible on arrival and J and K enter the grid', async ({page}) => {
  await ready(page);
  await expect(row(page, 8)).toHaveCount(0);
  await expect(row(page, 12)).toBeVisible();
  await page.keyboard.press('J');
  await expect(row(page, 1)).toBeFocused();
  await page.reload();
  await expect(row(page, 12)).toBeVisible();
  await page.keyboard.press('K');
  await expect(row(page, 12)).toBeFocused();
});

test('grid has one tab stop and preserves row and cell focus through keyboard navigation', async ({page}) => {
  await ready(page);
  const grid = page.getByRole('grid', {name: 'Transactions'});
  await page.getByRole('button', {name: 'Search', exact: true}).focus();
  await page.keyboard.press('Tab');
  await expect(row(page, 1)).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(row(page, 1).getByRole('checkbox')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(row(page, 1).getByRole('button', {name: /Change date/})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 2).getByRole('button', {name: /Change date/})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row(page, 2)).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(grid.locator(':focus')).toHaveCount(0);
  await page.keyboard.press('Shift+Tab');
  await expect(row(page, 2)).toBeFocused();
  await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);

  await row(page, 2).getByRole('checkbox').click();
  await row(page, 4).getByRole('checkbox').click({modifiers: ['Shift']});
  await expect(selection(page)).toHaveCount(3);
  await expect(row(page, 3)).toHaveAttribute('aria-selected', 'true');
});

test('J and K preserve cell focus and Escape clears selection before focus', async ({page}) => {
  await ready(page);
  await row(page, 2).focus();
  await page.keyboard.press('X');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  const date = (id: number) => row(page, id).getByRole('button', {name: /Change date/});
  await expect(date(2)).toBeFocused();
  await page.keyboard.press('J');
  await expect(date(3)).toBeFocused();
  await page.keyboard.press('K');
  await expect(date(2)).toBeFocused();
  await page.keyboard.press('Shift+J');
  await expect(date(3)).toBeFocused();
  await expect(selection(page)).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(selection(page)).toHaveCount(0);
  await expect(date(3)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row(page, 3)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.grid :focus')).toHaveCount(0);
});

test('G G and Shift+G jump to the first and last row while preserving column focus and selection', async ({page}) => {
  await ready(page);
  await page.keyboard.press('Shift+G');
  await expect(row(page, 12)).toBeFocused();
  await page.keyboard.press('X');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');

  const date = (id: number) => row(page, id).getByRole('button', {name: /Change date/});
  await expect(date(12)).toBeFocused();
  await page.keyboard.press('g');
  await expect(date(12)).toBeFocused();
  await page.keyboard.press('g');
  await expect(date(1)).toBeFocused();

  await page.keyboard.press('Shift+G');
  await expect(date(12)).toBeFocused();
  await expect(selection(page)).toHaveCount(1);
  await expect(row(page, 12)).toHaveAttribute('aria-selected', 'true');
});

test('keyboard focus uses scroll padding and stays put at the end of the grid', async ({page}) => {
  await page.setViewportSize({width: 1200, height: 360});
  await ready(page);
  await page.keyboard.press('J');
  for (let index = 1; index < 11; index++) await page.keyboard.press('J');
  const last = row(page, 12);
  await expect(last).toBeFocused();
  const bottom = await last.evaluate(element => element.getBoundingClientRect().bottom);
  expect(bottom).toBeLessThan(350);
  const scroll = await page.evaluate(() => window.scrollY);
  expect(scroll).toBeGreaterThan(0);
  await page.keyboard.press('J');
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
});

test('focused cells offer contextual commands and picker dismissal restores shortcuts', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('Home');
  await expect(row(page, 1).getByRole('checkbox')).toBeFocused();
  await page.keyboard.press('Control+k');
  for (const name of [/Change category/, /Edit payee/, /Set transaction date/, /Set note/, /Set tags/, /Mark reviewed/, /Open transaction/, /Find similar transactions/]) {
    await expect(dialog(page).getByRole('option', {name})).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(row(page, 1).getByRole('checkbox')).toBeFocused();

  for (const [key, title] of [['C', 'Change category'], ['T', 'Set tags'], ['C', 'Change category']]) {
    await page.keyboard.press(key);
    await expect(dialog(page)).toHaveAccessibleName(title);
    await page.keyboard.press('Escape');
  }
  await expect(row(page, 1)).toBeFocused();
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toHaveCount(0);
});

test('F opens filters, Ctrl+F clears facets and search, and G T returns to this month', async ({page}) => {
  await ready(page);
  await page.keyboard.press('F');
  await expect(dialog(page)).toHaveAccessibleName('Filter');
  await dialog(page).getByRole('option', {name: 'Tag', exact: true}).click();
  await expect(dialog(page).getByRole('option')).toHaveText(['Shared', 'Travel', 'Work']);
  await dialog(page).getByRole('option', {name: 'Travel'}).click();
  await expect(page.getByRole('button', {name: 'Remove filter Travel'})).toBeVisible();

  const search = page.getByRole('button', {name: 'Search', exact: true});
  await search.click();
  await expect(dialog(page)).toHaveAccessibleName('Search');
  await dialog(page).getByRole('textbox').fill('MUD Coffee');
  await dialog(page).getByRole('button', {name: 'Show results'}).click();
  await expect(page.getByRole('button', {name: 'Clear search'})).toBeVisible();
  await page.keyboard.press('Control+F');
  await expect(page.getByRole('button', {name: 'Clear search'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Remove filter Travel'})).toHaveCount(0);
  await expect(page.locator('[data-row-id]')).toHaveCount(11);

  await search.click();
  await dialog(page).getByRole('textbox').fill('MUD Coffee');
  await dialog(page).getByRole('button', {name: 'Show results'}).click();
  await page.keyboard.press('Control+k');
  const clearFilters = dialog(page).getByRole('option', {name: /Clear filters/});
  await expect(clearFilters.getByText('Ctrl+F', {exact: true})).toBeVisible();
  await clearFilters.click();
  await expect(page.getByRole('button', {name: 'Clear search'})).toHaveCount(0);

  await page.getByRole('button', {name: 'Previous month'}).click();
  await expect(row(page, 101)).toBeVisible();
  await row(page, 101).focus();
  await page.keyboard.press('G');
  await page.keyboard.press('T');
  await expect(row(page, 1)).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test('command search shows category values only within the filter scope', async ({page}) => {
  await ready(page);
  await page.keyboard.press('Control+k');
  const search = dialog(page).getByRole('combobox');
  await search.fill('Groceries');
  await expect(dialog(page).getByRole('option', {name: /Groceries/})).toHaveCount(0);
  await search.fill('Category');
  const category = dialog(page).getByRole('option', {name: 'Filter › Category', exact: true});
  await expect(category.locator('svg')).toBeVisible();
  await category.click();
  await expect(dialog(page)).toHaveAccessibleName('Filter by category');
  const food = dialog(page).getByRole('group', {name: 'Food', exact: true});
  await expect(food.getByRole('option', {name: 'Groceries', exact: true})).toBeVisible();
  const wholeFoodGroup = food.getByRole('option').first();
  await expect(wholeFoodGroup).toHaveAccessibleName('Food All in group');
  await expect(dialog(page).getByRole('option', {name: 'Transportation', exact: true})).toBeVisible();
  await wholeFoodGroup.click();
  await expect(row(page, 2)).toBeVisible();
  await expect(row(page, 5)).toBeVisible();
  await expect(row(page, 3)).toHaveCount(0);
  await page.getByRole('button', {name: 'Remove filter Food', exact: true}).click();

  await page.keyboard.press('F');
  await expect(dialog(page)).toHaveAccessibleName('Filter');
  const filterCategory = dialog(page).getByRole('option', {name: 'Category', exact: true});
  const reviewed = dialog(page).getByRole('option', {name: 'Reviewed', exact: true});
  const unreviewed = dialog(page).getByRole('option', {name: 'Unreviewed', exact: true});
  const reviewedIcon = reviewed.locator('svg.lucide-check');
  const unreviewedIcon = unreviewed.locator('svg.lucide-circle');
  await expect(reviewedIcon).toBeVisible();
  await expect(unreviewedIcon).toBeVisible();
  const categoryIconWidth = (await filterCategory.locator('svg').boundingBox())?.width;
  expect((await reviewedIcon.boundingBox())?.width).toBe(categoryIconWidth);
  expect((await unreviewedIcon.boundingBox())?.width).toBe(categoryIconWidth);
  await search.fill('Groceries');
  const groceries = dialog(page).getByRole('option', {name: 'Category › Food › Groceries', exact: true});
  await expect(groceries).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(groceries).toHaveAccessibleDescription('Filter active');
  await expect(page.getByRole('button', {name: 'Remove filter Groceries', includeHidden: true})).toBeAttached();

  await search.fill('Dining out');
  await expect(dialog(page).getByRole('option', {name: 'Category › Food › Dining out', exact: true})).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name: 'Remove filter Dining out'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Remove filter Groceries'})).toHaveCount(0);
});

test('command search offers one sort action per column and reverses the active sort', async ({page}) => {
  await ready(page);
  const search = dialog(page).getByRole('combobox');
  const payeeSort = dialog(page).getByRole('option', {name: /^Sort by › Payee /});
  const payeeHeader = page.getByRole('columnheader', {name: 'Payee'});

  await page.keyboard.press('Control+k');
  await expect(payeeSort).toHaveCount(0);
  await search.fill('payee');
  await expect(payeeSort).toHaveCount(1);
  await expect(payeeSort).toHaveAccessibleName('Sort by › Payee A to Z');
  await expect(payeeSort.locator('svg')).toBeVisible();
  const label = payeeSort.locator('.command-label');
  const direction = payeeSort.locator('.command-detail');
  await expect(label).toHaveText('Sort by › Payee');
  await expect(direction).toHaveText('A to Z');
  expect((await direction.boundingBox())!.x).toBeGreaterThan((await label.boundingBox())!.x);
  await payeeSort.click();
  await expect(payeeHeader).toHaveAttribute('aria-sort', 'ascending');

  await page.keyboard.press('Control+k');
  await search.fill('sort by payee z to a');
  await expect(payeeSort).toHaveCount(1);
  await expect(payeeSort).toHaveAccessibleName('Sort by › Payee Z to A');
  await payeeSort.click();
  await expect(payeeHeader).toHaveAttribute('aria-sort', 'descending');

  await page.keyboard.press('S');
  const submenuPayeeSort = dialog(page).getByRole('option', {name: /^Payee /});
  await expect(submenuPayeeSort).toHaveCount(1);
  await expect(submenuPayeeSort).toHaveAccessibleName('Payee A to Z');
  await expect(dialog(page).locator('[cmdk-item] svg')).toHaveCount(7);
});

test('category pickers show groups and pin selected entries at opening', async ({page}) => {
  const triggerErrors: string[] = [];
  page.on('console', entry => {
    if (entry.type() === 'error' && entry.text().includes('triggerIdProp')) triggerErrors.push(entry.text());
  });

  await ready(page);
  const target = row(page, 2);
  await target.focus();
  await page.keyboard.press('C');
  await expect(dialog(page).getByRole('option').first()).toHaveAccessibleName('Groceries');
  const food = dialog(page).getByRole('group', {name: 'Food', exact: true});
  await expect(food.getByRole('option', {name: 'Groceries', exact: true})).toBeVisible();
  await expect(dialog(page).getByRole('option', {name: 'Transportation', exact: true})).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  await dialog(page).getByRole('option', {name: /Change category/}).click();
  await expect(dialog(page).getByRole('option').first()).toHaveAccessibleName('Groceries');
  await expect(food.getByRole('option', {name: 'Dining out', exact: true})).toBeVisible();
  await expect(triggerErrors).toEqual([]);
});

test('tag picker pins current tags and keeps the same order while toggling', async ({page}) => {
  await ready(page);
  await row(page, 2).focus();
  await page.keyboard.press('T');
  const options = dialog(page).getByRole('option');
  await expect(options.first()).toHaveAccessibleName('Work');
  const order = await options.evaluateAll(items => items.map(item => item.querySelector('.choice-label')?.textContent));
  await options.first().click();
  await expect(options.first()).toContainText('Remove from all');
  expect(await options.evaluateAll(items => items.map(item => item.querySelector('.choice-label')?.textContent))).toEqual(order);
  await dialog(page).getByRole('button', {name: 'Apply tags'}).click();
  await expect(row(page, 2).locator('[data-editor-cell=tags]')).toHaveText('No tags');
  await expect(row(page, 1).locator('[data-editor-cell=note]')).toHaveText('No note');
});

test('payee suggestions float below the input and can save a known payee', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('P');
  const input = row(page, 1).getByRole('combobox', {name: 'Payee'});
  await input.fill('Superior');
  const suggestion = page.getByRole('option', {name: 'Superiority Burger'});
  await expect(suggestion).toBeVisible();
  await expect(row(page, 1).getByRole('option')).toHaveCount(0);
  const inputBounds = (await input.boundingBox())!;
  const listBounds = (await page.getByRole('listbox').locator('..').boundingBox())!;
  expect(Math.abs(listBounds.x - inputBounds.x)).toBeLessThan(2);
  expect(listBounds.y).toBeGreaterThan(inputBounds.y + inputBounds.height);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(row(page, 1)).toContainText('Superiority Burger');
  await expect(row(page, 1)).toBeFocused();
  await expect(page.getByRole('button', {name: 'Undo', exact: true})).toBeEnabled();

  await page.keyboard.press('P');
  await input.fill('Union');
  await page.getByRole('option', {name: 'Union Square Greenmarket'}).click();
  await expect(input).toHaveCount(0);
  await expect(row(page, 1)).toContainText('Union Square Greenmarket');
  await expect(row(page, 1)).toBeFocused();
});

test('bulk commands align counts and R reviews the selection with confirmation', async ({page}) => {
  await ready(page);
  await page.keyboard.press('J');
  await page.keyboard.press('Shift+J');
  const toolbar = page.getByRole('button', {name: 'Search', exact: true}).locator('..');
  await expect(toolbar.getByRole('status')).toHaveText('2 transactions selected');
  await page.keyboard.press('Control+k');
  const category = dialog(page).getByRole('option', {name: /Change category/}).getByText('2 transactions');
  const payee = dialog(page).getByRole('option', {name: /Set payee/}).getByText('2 transactions');
  await expect(category).toBeVisible();
  expect((await category.boundingBox())?.x).toBe((await payee.boundingBox())?.x);
  await expect(dialog(page).getByRole('option', {name: /Mark 2 reviewed/}).getByText('R', {exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('R');
  await expect(row(page, 1).getByRole('img', {name: 'Reviewed', exact: true})).toBeVisible();
  await expect(row(page, 2).getByRole('img', {name: 'Reviewed', exact: true})).toBeVisible();
  await expect(page.getByText('Marked reviewed', {exact: true})).toBeVisible();
});

test('budget category groups expand and collapse independently', async ({page}) => {
  await ready(page);
  const budget = page.getByRole('complementary', {name: 'Monthly budget'});
  const food = budget.locator('details').filter({hasText: 'Food'});
  await expect(food.getByRole('meter', {name: 'Food budget used'})).toHaveAttribute('max', '500');
  await expect(food.getByRole('meter', {name: 'Groceries budget used'})).toBeVisible();
  await food.locator('summary').click();
  await expect(food.getByRole('meter', {name: 'Groceries budget used'})).toBeHidden();
  await expect(budget.getByRole('meter', {name: 'Shopping budget used'})).toBeVisible();
  await expect(budget.getByRole('img', {name: 'Fees has no budget target'})).toHaveCSS('background-image', /repeating-linear-gradient/);
});
