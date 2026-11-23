# Pounce

_Pounce takes its name from “déjeuner sur le pouce,” French for grabbing a quick
lunch._

[![Tests](https://github.com/evanpurkhiser/pounce/actions/workflows/main.yml/badge.svg)](https://github.com/evanpurkhiser/pounce/actions/workflows/main.yml)
[![Lint](https://github.com/evanpurkhiser/pounce/actions/workflows/lint.yml/badge.svg)](https://github.com/evanpurkhiser/pounce/actions/workflows/lint.yml)

Pounce is a keyboard-first transaction inbox for Lunch Money.
Fly through a month of transactions, categorize them in batches,
and keep your budget in view as you review.

- Navigate with **J/K**, select rows with **X**,
  and change categories with **C**.
- Open **⌘K** or **Ctrl+K** for commands that work on the focused row
  or the whole selection.
  Press **?** for shortcuts.
- Undo and redo edits within your current session, including bulk changes.

## Try it

```sh
mise install
npm ci
npm run dev
```

Pounce opens with sample data.
Choose **Connect Lunch Money**
and enter an API token to work with your own budget.
Pounce stores the token in your browser
and saves live edits directly to Lunch Money.

## Develop

Run `npx playwright install chromium` once,
then `npm test` to run the acceptance suite against sample data
and a mocked API.
See the [transaction workflow spec](docs/command-palette.md)
for keyboard behavior and API details.
