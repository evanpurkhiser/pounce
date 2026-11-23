# Transactions UX

Pounce is a keyboard-first workspace for reviewing
and editing Lunch Money transactions.
The screen pairs a month of transactions with a budget panel.
Move to a row, correct its category or note, mark it reviewed, and keep going.
A selection turns the same commands into bulk actions.

## Month, filters, and search

The table loads a full calendar month in one continuous list.
Previous, next, and current month commands update the table and budget panel.
**Go to month…** accepts names such as `Nov 2026` and values such as `2026-11`.
Keep active filters when switching months and clear the row selection
and its anchor.
The budget panel stays scoped to the displayed month
as transaction filters change.

| Key sequence | Command                                       |
| ------------ | --------------------------------------------- |
| `G` then `N` | Go to the next month.                         |
| `G` then `P` | Go to the previous month.                     |
| `G` then `M` | Open **Go to month…** in the command palette. |
| `G` then `T` | Go to the current month.                      |

**Filter** opens the following groups.

- **Review status** → choose **Reviewed** or **Unreviewed**.
  With a review filter active,
  choose the other status or **Any review status** to clear it.
- **Category** → category groups, individual categories, and Uncategorized.
  The first option under each heading selects the whole group
  and carries an **All in group** badge.
- **Tag** → budget tags in name order.
- **Account** → connected accounts, manual accounts, and Cash.
- **Clear filters** → remove the active filters.

Press `F` to open Filter.
**Clear filters** or `Ctrl+F` clears facets and search.
Show active filters as removable chips.
Different facets combine with AND.
The category facet matches any selected category.
In a multi-value filter picker,
Enter replaces that facet with the highlighted value and closes.
**⌘Enter** or **Ctrl+Enter** toggles the value and keeps the picker open.
Provide a visible toggle and **Done** button.

The URL stores active filter values, search text, and explicit sort.
Back and Forward restore filter and sort changes.

**Search** searches payee names, original descriptors,
and notes in the current month.
**Search a wider date range** expands the scope explicitly.
Show the active date range and filters with the results.

## Columns and sorting

The grid shows the selection checkbox, Date, Category, Payee, Amount, Note,
Tags, and Review in that order.
Review uses a green circled check for reviewed rows and a gray circle
for unreviewed rows.
A gray check labels the compact Review heading visually.
The heading and status have accessible labels.
Amount shows icons for split transactions
and transactions linked to a recurring item.
Empty Note and Tags cells are blank and can still open their editors.
The header sticks to the top of the viewport as the page scrolls.
Cells stay on one line and long text shows an ellipsis.

Click a data column header to sort and click it again to reverse the direction.
**Sort by** in Command K offers one action per column,
with `S` opening it directly.
Choose a new column to use its default direction,
or choose the current column to reverse it.
Date defaults to newest first and other columns default to ascending.
The default is newest first, and search results default to relevance.
An explicit column sort applies across months and search results.
**Search relevance** in the sort menu restores relevance ordering
while searching.
Amounts sort in the budget currency.
Sorting preserves selected row IDs
and keyboard range selection follows the new order.

## Monthly budget

The budget panel stays on the right as the desktop workspace scrolls
and has its own scrollbar.
Press `]` or use the **Budget** button to toggle it.
The panel shows category groups with expandable child rows.
A gray striped bar marks a category without a budget target.
Group rows use Lunch Money’s group totals when available
and otherwise roll up their children.

## Grid focus and selection

Transactions starts with all review statuses visible.
**Row focus** identifies the active transaction.
**Field focus** belongs to that transaction's editor or picker.
Moving focus leaves **selection** intact.
A filter change deselects rows it hides.
Rows still visible stay selected,
and clearing the filter leaves previously hidden rows unselected.

| Key                                            | Action                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tab` / `Shift+Tab`                            | Enter the grid at its last focus, or the first row on first entry. Within a row, move between columns and leave the grid at either edge.                                          |
| `J` / `K`                                      | Move row focus down / up. A focused cell keeps its column as you move. From outside the grid, `J` focuses the first visible row and `K` focuses the last.                         |
| `G` then `G` / `Shift+G`                       | Jump to the first / last visible row. Keep the focused column and current selection.                                                                                              |
| Arrow keys                                     | Move between rows or cells. Left and Right enter or move across the current row. Up and Down preserve the column when a cell has focus.                                           |
| `Home` / `End`                                 | Focus the first or last cell in the row. Hold Ctrl to jump to the first or last cell in the grid.                                                                                 |
| `Page Up` / `Page Down`                        | Move focus by roughly one viewport of transactions.                                                                                                                               |
| `X`                                            | Toggle the focused row's selection and set the anchor. A row checkbox also sets the anchor.                                                                                       |
| `⌘A` / `Ctrl+A`                                | With grid focus, select all rows in the current filtered view, including rows outside the viewport. Keep focus on the active row. In a text input, select its text.               |
| `Shift+X`                                      | Select the visible range from the anchor through the focused row without moving focus.                                                                                            |
| `Shift+J` / `Shift+K` or `Shift+↓` / `Shift+↑` | Move focus down / up and adjust the range from the same anchor.                                                                                                                   |
| `Esc`                                          | Close the active editor and discard its draft. On successive presses, clear the selection, return from cell focus to row focus, then leave the row. Skip steps that do not apply. |

Range shortcuts share one active range in the current visible order.
If there is no visible anchor,
start at the row that had focus before the shortcut.
The range includes both endpoints while focus is away from the anchor.
Moving back toward the anchor shrinks the range.
Returning to the anchor with Shift navigation clears the active range,
and passing it starts a range in the opposite direction.
Independently selected rows stay selected throughout.

With row 5 focused and nothing selected, `Shift+↓` selects rows 5–6.
`Shift+↑` returns to row 5 and clears the range.
Another `Shift+↑` selects rows 4–5.

Field editors and the palette handle their own typing and navigation.
Suspend direct row shortcuts, month sequences,
and the shortcut-overlay binding while an editor or the palette owns focus.

## Command palette

Open the palette with **⌘K** or **Ctrl+K**.
Press **Ctrl+N** or **Ctrl+P** to move down or up through commands
and picker results.
Table commands are always available on the Transactions screen.
They include **Filter**, **Sort by**, **Search**, month navigation,
and **Undo last edit** or **Redo last edit** when available.

Show transaction actions above table commands when visible rows are selected
or a row has focus.
A visible selection takes precedence.
With no selection, use the focused row.
Capture the target IDs before opening an editor
and keep them through nested pickers.
Show the affected count in bulk action labels and editors.

A bare query searches the current menu and the immediate children of submenus
that opt in.
In Command K, `Category` can find **Filter › Category**.
Open **Filter** with `F` to search values directly,
such as `Groceries` for **Category › Food › Groceries**.
A named prefix moves the search scope,
so `filter resturaunts` can find **Filter › Category › Food › Dining out** from
Command K. In Command K, `Payee` can find **Sort by › Payee**, with **A to Z**
on the right.
Type `sort by payee` to search within **Sort by**.

In filter results, Enter applies one value and closes the palette.
**⌘Enter** or **Ctrl+Enter** toggles a value for a multi-value filter
and keeps the search open.

The palette and searchable pickers share fuzzy matching and ranking for names
and aliases.
Typing `resturaunts` in a category picker should find **Dining out** under
**Food** through the same `restaurants` alias as the palette.
The palette also matches the command path and decides
when to surface nested choices.
A picker searches the field’s choices,
including parent category names on category choices.
Category and tag editors pin the choices associated with the target rows
when opened and keep that order as choices change.

Closing the palette or editor restores focus to the invoking control
or grid cell.
If an action takes the focused transaction out of the current view,
focus the next visible row.
**?**
opens the keyboard-shortcut overlay.
Escape closes it and restores the previous focus.

## Transaction edits

**Change category** appears first in the contextual action list.

| Action                                  | Direct key | One focused or selected transaction                                                                                                                                | Multiple selected transactions                                                                                                                                                                         |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Change category…**                    | `C`        | Open a searchable dropdown at the target row’s Category cell.                                                                                                      | Open the category picker in the palette and apply one category to all targets.                                                                                                                         |
| **Edit payee…**                         | `P`        | Select the payee text in the cell and show a floating list of matching payees from loaded transactions. Choose a suggestion or leave the field to save a new name. | Open **Set payee…** in the palette and apply one replacement payee.                                                                                                                                    |
| **Set transaction date…**               | `D`        | Open the date editor at the target row’s Date cell, with the existing date.                                                                                        | Open the date picker in the palette. Show the chosen date and affected count before applying.                                                                                                          |
| **Set note…**                           | `N`        | Select the existing note text in the Note cell. The editor grows over the grid as the text wraps.                                                                  | Open **Replace notes…** in the palette. Start blank if notes differ. Emptying an edited field clears the notes.                                                                                        |
| **Set tags…**                           | `T`        | Open a searchable tag multi-select at the target row’s Tags cell.                                                                                                  | Open the same picker in the palette with mixed tag states.                                                                                                                                             |
| **Mark reviewed** / **Mark unreviewed** | `R`        | The palette shows the action that changes the target's status. The direct key toggles the target row, including a split child.                                     | Show each action that changes eligible rows in the selection. Show affected counts. `R` marks eligible unreviewed rows reviewed first, or marks eligible reviewed rows unreviewed if all are reviewed. |

Clicking a field or using its direct shortcut opens the single-row editor.
Leaving an inline payee or note field saves the edit
and keeps focus at its destination.
Leaving a changed bulk text field saves and closes the editor.
Enter saves a note or confirms a payee.
For payees, Enter uses the highlighted suggestion when one is active
or saves the typed name.
Pasted line breaks become spaces.
An empty note clears the note.
Escape discards the draft and returns focus to the row.
Bulk edit shortcuts focus the first input in the palette.
The palette aligns affected transaction counts in a separate column
and shows the `R` hint beside its current review action.

### Searchable pickers

One- to three-character terms match word prefixes.
Longer terms also match typos.
Arrow keys move the highlight.
The picker retains staged values as its query changes.

- **Category** uses single-select.
  Show the category shared by all targets as checked
  and categories used by some targets as mixed, with a count such as **2 of 4**.
  Enter sets the highlighted category on every target and closes the picker.
  **Uncategorized** clears the category.
- **Tags** use multi-select.
  Show checked for all targets, unchecked for none,
  and mixed with a count for some.
  Enter toggles the highlighted tag and keeps the picker open.
  Activating a mixed or unchecked tag stages adding it to all targets.
  Activating a checked tag stages removing it from all.
  The user can toggle a staged change or reset
  that tag to its original distribution.
  **Apply tags** saves the staged changes
  and preserves untouched tag memberships.
  Escape discards the draft.

### Undo and redo

**⌘Z** or **Ctrl+Z** undoes the last transaction edit.
**⌘⇧Z** or **Ctrl+Shift+Z** redoes it.
While editing text, those shortcuts operate on the text.
Transaction history stays available across month changes in the same budget.

A toast confirms successful writes, undo, and redo.
Each successful action is one history entry, including a bulk edit.
Keep the before and after values for the changed fields of each transaction.
Undo writes back the before values and redo reapplies the after values.
Refresh affected rows and budget summaries after a successful write.
A new successful edit clears the redo history.
If a write fails or the affected fields changed elsewhere,
identify the transactions that need attention
and retain the history needed to retry.

## Open UX decisions

- **Review loop.**
  Decide where focus should move after reviewing a transaction
  that stays visible.
- **Selection controls and navigation bounds.**
  Define the header checkbox scope and what happens at the first
  or last visible row during navigation.
- **Feedback and recovery.**
  Design loading, empty, saving, success, and error states.
  Decide how to present partial success across several API writes.
  Decide whether history survives a reload and how conflicts appear in the UI.
- **Search and budget context.**
  Define the wider-date search picker and what the budget panel shows
  when a calendar month overlaps different budget periods.
- **Accessibility and input parity.**
  Verify how focus, selected counts, mixed states,
  and save outcomes are announced.
  Define the equivalent pointer and touch flows,
  plus shortcut discovery and an option to turn off single-letter shortcuts.

Follow-on filters include **Amount**, **Recurring item**,
and **Has attachment**.
Follow-on edits include **Edit amount or currency**, **Move to account**,
**Link or unlink recurring item**,
and **Attach receipt** for eligible transactions.
Account and amount edits depend on synced-account settings.
**Split transaction** and **Group selected transactions** have dedicated flows
that show the resulting parent and children.

## Lunch Money v2 API mapping

| Commands                                      | API behavior                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Month navigation and review filters           | Use `GET /transactions` with `start_date`, `end_date`, and `status`. Fetch API pages behind the scenes so table search and counts cover the full requested range. Request posted transactions and exclude pending rows from the transaction list.                                                                                                                                                                  |
| Category, tag, account, and recurring filters | Load choices from `/categories`, `/tags`, `/manual_accounts`, `/plaid_accounts`, and `/recurring_items`. Transaction filters accept a single ID per parameter. Use a single API value where it matches the request, and apply multi-value facets over the full paginated range within the other compatible filters. Category groups expand to their member categories for local filtering.                         |
| Search                                        | Search locally within the fetched date range. The transaction list exposes `payee`, `original_name`, and `notes` in the rows, with no free-text query parameter. Complete pagination for the requested scope before reporting a definitive result count or empty state.                                                                                                                                            |
| Amount and attachment filters                 | Evaluate these over the fetched rows. Define the currency basis before comparing amounts across currencies. Request `include_files` when attachment data is needed.                                                                                                                                                                                                                                                |
| Monthly budget panel                          | Read `GET /summary` for the date range and `GET /budgets/settings` for budget cadence. A calendar month can overlap multiple budget periods. Label the date range and use aligned periods for budget targets when the user’s cadence differs.                                                                                                                                                                      |
| Row edits and bulk edits                      | Use `PUT /transactions/{id}` for single rows and for split or grouped rows in a selection. Send ordinary rows through `PUT /transactions` in batches of up to 500. Send only the intended fields and preserve review status on unrelated edits. Use `additional_tag_ids` for add-only tag changes. When removing tags, calculate the complete `tag_ids` array for each changed transaction using its current tags. |
| Group and split                               | Use the dedicated transaction group and split endpoints. Read back the resulting hierarchy and use the detail endpoint for child transactions when needed.                                                                                                                                                                                                                                                         |

Sources are the
[official v2 API reference](https://developers.lunchmoney.app/v2/docs),
[generated API types](https://github.com/lunch-money/lunch-money-js-v2/blob/main/src/types.generated.ts),
[transaction pagination](https://developers.lunchmoney.app/pagination),
[v2 update semantics](https://developers.lunchmoney.app/v2/overview#updating-objects-put),
and [v2 migration guide](https://developers.lunchmoney.app/v2/migration-guide).
