# Lunchline

A keyboard-first transaction inbox for Lunch Money. The app opens in the current month's Unreviewed view. Sample data supports the full review and editing flow without an account.

```sh
npm ci
npm run dev
```

To switch to live data, choose **Connect Lunch Money** and enter an API token for a Lunch Money budget. The frontend sends requests directly to the v2 API and holds the token in memory until disconnect or reload. Edits in a connected budget are saved to Lunch Money. Use a test budget when trying out the editing workflow.

Press **⌘K** or **Ctrl+K** for commands and **?** for shortcuts. Navigate with the arrow keys or **J/K**, select with **X** or **Shift+X**, and edit categories, dates, notes, payees, and tags with **C/D/N/P/T**. **R** toggles review for a focused eligible row. **⌘Z** and **⌘⇧Z** undo and redo within the current session.

## Product design

See the [Transactions UX spec](docs/command-palette.md) for the review workflow, keyboard behavior, and v2 API mapping.

## Stack

- React, TypeScript, and Vite.
- React Aria Table and DatePicker for the grid, row selection, and date entry.
- Base UI for dialogs, category and tag comboboxes, payee autocomplete, and detail tabs.
- cmdk for command navigation, Fuse.js for shared fuzzy ranking, and TanStack Hotkeys for shortcuts.
- TanStack DB for reactive rows and optimistic edits. TanStack Query loads date ranges, metadata, and budget summaries. Lunchline keeps the session's undo and redo entries and writes their patches through the same API path.

## Acceptance tests

```sh
npx playwright install chromium
npm test
```

Tests use sample data and an intercepted API. The default configuration starts a Vite server on port 5179. To test a running preview from the matching Playwright container on Linux, run the following from the repository root.

```sh
podman run --rm --network host --ipc host --userns keep-id \
  -v "$PWD:/work" -w /work \
  -e LUNCHLINE_TEST_URL=http://127.0.0.1:5178 \
  mcr.microsoft.com/playwright:v1.65.1-noble npm test
```
