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
  await expect(selection(page)).toHaveCount(8);

  await page.getByRole('button', {name: 'Commands'}).click();
  await dialog(page).getByRole('combobox').fill('filter resturaunts');
  await expect(dialog(page).getByRole('option', {name: 'Filter › Category › Dining out'})).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(selection(page)).toHaveCount(1);
  await page.getByRole('button', {name: 'Remove filter Dining out'}).click();
  await expect(selection(page)).toHaveCount(1);
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
  await expect(row(page, 2)).toHaveAttribute('data-active', 'true');
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

test('single payee accepts a new value, notes cancel, and bulk shortcuts open directly', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('P');
  const payee = page.getByRole('combobox', {name: 'Payee'});
  await expect(payee).toBeFocused();
  expect(await payee.evaluate(input => (input as HTMLInputElement).selectionEnd)).toBe('MUD Coffee'.length);
  await page.keyboard.insertText('New merchant');
  await page.getByRole('button', {name: 'Save payee'}).click();
  await expect(row(page, 1)).toContainText('New merchant');

  await page.keyboard.press('N');
  const note = dialog(page).getByRole('textbox', {name: 'Note'});
  await expect(note).toBeFocused();
  await note.fill('discard this');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(row(page, 1)).toHaveAttribute('data-active', 'true');

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

test('month sequences and review advance work with row focus', async ({page}) => {
  await ready(page);
  await row(page, 1).focus();
  await page.keyboard.press('R');
  await expect(row(page, 1)).toHaveCount(0);
  await expect(row(page, 2)).toHaveAttribute('data-active', 'true');
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
  await expect(headers).toHaveText(['✓', 'Date↓', 'Category↕', 'Payee↕', 'Amount↕', 'Note↕', 'Tags↕', 'Review✓']);
  await expect(date).toHaveAttribute('aria-sort', 'descending');
  await expect(row(page, 1).getByRole('img', {name: 'Unreviewed'})).toBeVisible();

  await row(page, 1).focus();
  await page.keyboard.press('X');
  await amount.click();
  await expect(amount).toHaveAttribute('aria-sort', 'ascending');
  await expect(displayed.first()).toHaveAttribute('data-row-id', '1');
  await amount.click();
  await expect(amount).toHaveAttribute('aria-sort', 'descending');
  await expect(displayed.first()).toHaveAttribute('data-row-id', '8');

  await row(page, 1).focus();
  await page.keyboard.press('A');
  await expect(dialog(page)).toHaveAccessibleName('Sort by');
  await dialog(page).getByRole('option', {name: 'Date · Oldest first'}).click();
  await expect(date).toHaveAttribute('aria-sort', 'ascending');
  await expect(displayed.first()).toHaveAttribute('data-row-id', '8');
  await expect(row(page, 1)).toBeFocused();
  await expect(row(page, 1)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Control+k');
  await dialog(page).getByRole('option', {name: /^Sort by/}).click();
  await dialog(page).getByRole('option', {name: 'Date · Newest first'}).click();
  await expect(date).toHaveAttribute('aria-sort', 'descending');
  await expect(displayed.first()).toHaveAttribute('data-row-id', '1');
  await page.getByRole('button', {name: 'Remove filter Unreviewed'}).click();
  await expect(row(page, 9).getByRole('img', {name: 'Reviewed', exact: true})).toHaveAttribute('data-reviewed', 'true');
  await review.click();
  await expect(review).toHaveAttribute('aria-sort', 'ascending');
  await review.click();
  await expect(review).toHaveAttribute('aria-sort', 'descending');
});

test('leaving the inline payee editor discards the draft and releases shortcuts', async ({page}) => {
  await ready(page);
  const payee = page.getByRole('combobox', {name: 'Payee'});
  const commands = page.getByRole('button', {name: /^Commands/});
  await row(page, 1).focus();
  await page.keyboard.press('P');
  await payee.fill('Unsaved merchant');
  await commands.click();
  await expect(dialog(page)).toHaveAccessibleName('Commands');
  await page.keyboard.press('Escape');
  await expect(commands).toBeFocused();
  await expect(payee).toHaveCount(0);
  await expect(row(page, 1)).toContainText('MUD Coffee');

  await row(page, 1).focus();
  await page.keyboard.press('P');
  await payee.fill('Unsaved tab draft');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Save payee'})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(payee).toHaveCount(0);
  await expect(row(page, 1)).toContainText('MUD Coffee');

  await row(page, 1).focus();
  await page.keyboard.press('J');
  await expect(row(page, 2)).toBeFocused();
});
