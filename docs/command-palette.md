# Transactions UX

Lunchline is a keyboard-first workspace for reviewing and editing Lunch Money transactions. The screen pairs a month of transactions with a budget panel. Move to a row, correct its category or note, mark it reviewed, and keep going. A selection turns the same commands into bulk actions.

## Month, filters, and search

The table loads a full calendar month in one continuous list. Previous, next, and current month commands update the table and budget panel. **Go to month…** accepts names such as `Nov 2026` and values such as `2026-11`. Keep active filters when switching months and clear the row selection and its anchor. The budget panel stays scoped to the displayed month as transaction filters change.

| Key sequence | Command |
| --- | --- |
| `G` then `N` | Go to the next month. |
| `G` then `P` | Go to the previous month. |
| `G` then `M` | Open **Go to month…** in the command palette. |

**Filter** opens the following groups.

- **Review status** → Reviewed, Unreviewed, or Any review status.
- **Category** → category groups, individual categories, and Uncategorized.
- **Tag** → budget tags, including travel and project tags.
- **Account** → connected accounts, manual accounts, and Cash.
- **Posting state** → Pending, Posted, or Any posting state.
- **Clear filters** → remove the active filters.

Show active filters as removable chips. Different facets combine with AND. The category facet matches any selected category. In a multi-value filter picker, Enter replaces that facet with the highlighted value and closes. **⌘Enter** or **Ctrl+Enter** toggles the value and keeps the picker open. Provide a visible toggle and **Done** button.

**Search transactions** searches payee names, original descriptors, and notes in the current month. **Search a wider date range** expands the scope explicitly. Show the active date range and filters with the results. **Find similar transactions** starts from a single transaction's payee and ranks normalized payee matches first.

## Columns and sorting

The grid shows the selection checkbox, Date, Category, Payee, Amount, Note, Tags, and Review in that order. Review uses a white check in a green circle for reviewed rows and a gray circle otherwise. A gray check labels the compact Review heading visually. The heading and status have accessible labels.

Click a data column header to sort and click it again to reverse the direction. **Sort by** in Command K lists both directions for each column, with `A` opening it directly. The default is newest first, and search results default to relevance. An explicit column sort applies across months and search results. **Search relevance** in the sort menu restores relevance ordering while searching. Amounts sort in the budget currency. Sorting preserves selected row IDs and keyboard range selection follows the new order.

## Grid focus and selection

**Row focus** identifies the active transaction. **Field focus** belongs to that transaction's editor or picker. Moving focus leaves **selection** intact. A filter change deselects rows it hides. Rows still visible stay selected, and clearing the filter leaves previously hidden rows unselected.

| Key | Action |
| --- | --- |
| `J` / `K` or `↓` / `↑` | Move row focus down / up. |
| `X` | Toggle the focused row's selection and set the anchor. A row checkbox also sets the anchor. |
| `⌘A` / `Ctrl+A` | With grid focus, select all rows in the current filtered view, including rows outside the viewport. Keep focus on the active row. In a text input, select its text. |
| `Shift+X` | Select the visible range from the anchor through the focused row without moving focus. |
| `Shift+J` / `Shift+K` or `Shift+↓` / `Shift+↑` | Move focus down / up and adjust the range from the same anchor. |
| `Esc` | Exit field focus and discard any uncommitted draft. Return to the row and keep the selection. |

Range shortcuts share one active range in the current visible order. If there is no visible anchor, start at the row that had focus before the shortcut. The range includes both endpoints while focus is away from the anchor. Moving back toward the anchor shrinks the range. Returning to the anchor with Shift navigation clears the active range, and passing it starts a range in the opposite direction. Independently selected rows stay selected throughout.

With row 5 focused and nothing selected, `Shift+↓` selects rows 5–6. `Shift+↑` returns to row 5 and clears the range. Another `Shift+↑` selects rows 4–5.

Field editors and the palette handle their own typing and navigation. Suspend direct row shortcuts, month sequences, and the shortcut-overlay binding while an editor or the palette owns focus.

## Command palette

Open the palette with **⌘K** or **Ctrl+K**. Table commands are always available on the Transactions screen. They include **Filter**, **Sort by**, **Search transactions**, month navigation, and **Undo last edit** or **Redo last edit** when available.

Show transaction actions above table commands when visible rows are selected or a row has focus. A visible selection takes precedence. With no selection, use the focused row. Capture the target IDs before opening an editor and keep them through nested pickers. Show the affected count in bulk action labels and editors.

Users can browse groups or jump straight to a nested choice. A command-only prefix such as `fi` shows **Filter**. A query with a matching choice term such as `filter resturaunts` can surface **Filter › Category › Dining out**.

The palette and searchable pickers share fuzzy matching and ranking for names and aliases. Typing `resturaunts` in a category picker should find **Dining out** through the same `restaurants` alias as the palette. The palette also matches the command path and decides when to surface nested choices. A picker searches only the choices available for its field.

Closing the palette or editor restores focus to the invoking control or grid cell. If an action takes the focused transaction out of the current view, focus the next visible row. **?** opens the keyboard-shortcut overlay. Escape closes it and restores the previous focus.

## Transaction edits

**Change category** appears first in the contextual action list. With a single target, the palette also offers **Open transaction** and **Find similar transactions**.

| Action | Direct key | One focused or selected transaction | Multiple selected transactions |
| --- | --- | --- | --- |
| **Change category…** | `C` | Open the category picker. | Open the category picker in the palette and apply one category to all targets. |
| **Edit payee…** | `P` | Focus the inline editor and select all the payee text. Save or Escape returns focus to the row. Clicking or tabbing away discards the draft and leaves focus at its destination. | Open **Set payee…** in the palette and apply one replacement payee. |
| **Set transaction date…** | `D` | Open the row's date picker at the existing date. | Open the date picker in the palette. Show the chosen date and affected count before applying. |
| **Set note…** | `N` | Open the Notes tab and focus the existing note for editing or clearing. | Open **Replace notes…** in the palette. Start blank if notes differ. Require an explicit clear action to remove existing notes. |
| **Set tags…** | `T` | Open the searchable tag multi-select. | Open the same picker in the palette with mixed tag states. |
| **Mark reviewed** / **Mark unreviewed** | `R` | The palette shows the action that changes the target's status. The direct key toggles the focused row. | Show each action that changes eligible rows in the selection. Use the affected counts, such as **Mark 2 reviewed** and **Mark 1 unreviewed**. |

A bulk shortcut opens its editor directly, with focus in the first input. `R` is the review shortcut. Bulk review uses the explicit palette actions.

### Searchable pickers

Typing filters choices and arrow keys move the highlight. The picker retains staged values as its query changes.

- **Category** uses single-select. Show the category shared by all targets as checked and categories used by some targets as mixed, with a count such as **2 of 4**. Enter sets the highlighted category on every target and closes the picker. **Uncategorized** clears the category.
- **Tags** use multi-select. Show checked for all targets, unchecked for none, and mixed with a count for some. Enter toggles the highlighted tag and keeps the picker open. Activating a mixed or unchecked tag stages adding it to all targets. Activating a checked tag stages removing it from all. The user can toggle a staged change or reset that tag to its original distribution. **Apply tags** saves the staged changes and preserves untouched tag memberships. Escape discards the draft.

### Undo and redo

**⌘Z** or **Ctrl+Z** undoes the last transaction edit. **⌘⇧Z** or **Ctrl+Shift+Z** redoes it. While editing text, those shortcuts operate on the text. Transaction history stays available across month changes in the same budget.

Each successful action is one history entry, including a bulk edit. Keep the before and after values for the changed fields of each transaction. Undo writes back the before values and redo reapplies the after values. Refresh affected rows and budget summaries after a successful write. A new successful edit clears the redo history. If a write fails or the affected fields changed elsewhere, identify the transactions that need attention and retain the history needed to retry.

## Open UX decisions

- **Starting view and review loop.** Decide whether opening Transactions starts in Unreviewed, All, or the last-used view. Set the default focus and what a successful review does when the row stays visible. The current rule covers edits that take the focused row out of the view.
- **Row layout and editing.** Choose where transaction details and the Notes editor appear and the pointer affordances for opening editors. Specify save behavior for date and note edits, including what happens when the user clicks away.
- **Selection controls and navigation bounds.** Define the header checkbox scope and what happens at the first or last visible row during navigation.
- **Feedback and recovery.** Design loading, empty, saving, success, and error states. Decide how to present ineligible targets and partial success across several API writes. Decide whether history survives a reload and how conflicts appear in the UI.
- **Search and budget context.** Define the wider-date search picker, how similar search interacts with active filters, and what the budget panel shows when a calendar month overlaps different budget periods.
- **Accessibility and input parity.** Verify how focus, selected counts, mixed states, and save outcomes are announced. Define the equivalent pointer and touch flows, plus shortcut discovery and an option to turn off single-letter shortcuts.

Follow-on filters include **Amount**, **Recurring item**, and **Has attachment**. Follow-on edits include **Edit amount or currency**, **Move to account**, **Link or unlink recurring item**, and **Attach receipt** for eligible transactions. Account and amount edits depend on synced-account settings. **Split transaction** and **Group selected transactions** have dedicated flows that show the resulting parent and children.

## Lunch Money v2 API mapping

| Commands | API behavior |
| --- | --- |
| Month navigation and review filters | Use `GET /transactions` with `start_date`, `end_date`, and `status`. Fetch API pages behind the scenes so table search and counts cover the full requested range. Pending transactions are always unreviewed, so treat posting state as a separate facet. Use `is_pending` for an explicit pending or posted filter. |
| Category, tag, account, and recurring filters | Load choices from `/categories`, `/tags`, `/manual_accounts`, `/plaid_accounts`, and `/recurring_items`. Transaction filters accept a single ID per parameter. Use a single API value where it matches the request, and apply multi-value facets over the full paginated range within the other compatible filters. Category groups expand to their member categories for local filtering. |
| Search and similar transactions | Search locally within the fetched date range. The transaction list exposes `payee`, `original_name`, and `notes` in the rows, with no free-text or similarity query parameter. Complete pagination for the requested scope before reporting a definitive result count or empty state. |
| Amount and attachment filters | Evaluate these over the fetched rows. Define the currency basis before comparing amounts across currencies. Request `include_files` when attachment data is needed. |
| Monthly budget panel | Read `GET /summary` for the date range and `GET /budgets/settings` for budget cadence. A calendar month can overlap multiple budget periods. Label the date range and use aligned periods for budget targets when the user’s cadence differs. |
| Row edits and bulk edits | Use `PUT /transactions/{id}` for a single row and `PUT /transactions` for eligible batches. Bulk accepts up to 500 rows and excludes split or grouped transactions. Show eligibility before submitting. Send only the intended fields and preserve review status on unrelated edits. Use `additional_tag_ids` for add-only tag changes. When removing tags, calculate the complete `tag_ids` array for each changed transaction using its current tags. |
| Group and split | Use the dedicated transaction group and split endpoints. Read back the resulting hierarchy and use the detail endpoint for child transactions when needed. |

Sources are the [official v2 API reference](https://developers.lunchmoney.app/v2/docs), [generated API types](https://github.com/lunch-money/lunch-money-js-v2/blob/main/src/types.generated.ts), [transaction pagination](https://developers.lunchmoney.app/pagination), [v2 update semantics](https://developers.lunchmoney.app/v2/overview#updating-objects-put), and [v2 migration guide](https://developers.lunchmoney.app/v2/migration-guide).
