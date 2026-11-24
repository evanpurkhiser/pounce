import {useLayoutEffect, useMemo, useRef, useState} from 'react';

import {Popover} from '@base-ui/react/popover';
import {useLiveQuery} from '@tanstack/react-db';
import {useHotkeys} from '@tanstack/react-hotkeys';
import {QueryClientProvider, useQuery} from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Command,
  Filter as FilterIcon,
  Search,
  Wallet,
} from 'lucide-react';
import {Toaster, toast} from 'sonner';

import {Budget} from '../budget/Budget';
import {
  currentMonth,
  liveSource,
  monthLabel,
  monthRange,
  shiftMonth,
  type Choice,
  type Range,
  type Row,
} from '../data/api';
import {demoSource} from '../data/demo';
import {draftChange} from '../data/editChanges';
import {createSession, message, type Session} from '../data/session';
import {useEdits} from '../data/useEdits';
import {useTransactionPages} from '../data/useTransactionPages';
import {RangeEditor} from '../editors/Editors';
import {TransactionEditor, type RowPatch} from '../editors/TransactionEditor';
import {Grid} from '../transactions/Grid';
import {
  cellEditorTriggerId,
  editActions,
  editTitle,
  isCellEditorField,
  reviewShortcut,
  reviewStatusFor,
  reviewTargets,
  transactionCountLabel,
  type CellEditorField,
  type Field,
  type InlineEditorField,
  type ReviewStatus,
} from '../transactions/transactionActions';
import {
  facetLabels,
  filterCommands,
  reviews,
  sortCommands,
  tableCommand,
  transactionCommands,
} from '../transactions/transactionCommands';
import type {Facet, MultiValueFacet} from '../transactions/transactionView';
import {useTransactionGrid} from '../transactions/useTransactionGrid';
import {useTransactionView} from '../transactions/useTransactionView';
import {CommandList, Modal, Picker, useInitialFocus} from '../ui/Palette';
import paletteStyles from '../ui/Palette.module.css';
import ui from '../ui/ui.module.css';

import styles from './App.module.css';

type Overlay =
  | {
      kind:
        | 'commands'
        | 'sort'
        | 'filters'
        | 'month'
        | 'search'
        | 'range'
        | 'shortcuts'
        | 'connect';
    }
  | {kind: 'facet'; facet: MultiValueFacet}
  | {kind: 'edit'; field: Field; ids: number[]};

type WorkspaceSurface =
  | {
      kind: 'palette';
      overlay: Overlay;
      origin: {element: HTMLElement | null; rowId?: number};
    }
  | {kind: 'inline'; id: number; field: InlineEditorField}
  | {kind: 'cell'; id: number; field: CellEditorField; anchor: HTMLElement};

const tokenStorageKey = 'pounce.lunchMoneyToken';

function readToken() {
  try {
    return localStorage.getItem(tokenStorageKey) ?? undefined;
  } catch {
    return;
  }
}

function createConnection(id: number, token?: string) {
  return {
    session: createSession(token ? liveSource(token) : demoSource()),
    live: Boolean(token),
    id,
  };
}

export function App() {
  const [connection, setConnection] = useState(() => createConnection(0, readToken()));

  function connect(token?: string) {
    try {
      if (token) {
        localStorage.setItem(tokenStorageKey, token);
      } else {
        localStorage.removeItem(tokenStorageKey);
      }
    } catch {
      if (token) {
        toast.warning(
          'The browser could not save the key. This connection lasts until reload.',
        );
      } else {
        toast.warning('The browser could not clear the saved key.');
      }
    }

    setConnection(previous => createConnection(previous.id + 1, token));
  }

  return (
    <QueryClientProvider client={connection.session.query}>
      <Workspace key={connection.id} {...connection} connect={connect} />
      <Toaster theme="system" richColors position="bottom-right" />
    </QueryClientProvider>
  );
}

function Workspace({
  session,
  live,
  connect,
}: {
  session: Session;
  live: boolean;
  connect: (token?: string) => void;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [customRange, setCustomRange] = useState<Range>();
  const [surface, setSurface] = useState<WorkspaceSurface>();
  const [cellEditorHandle] = useState(() => Popover.createHandle());
  const [letterKeys, setLetterKeys] = useState(true);
  const [budgetOpen, setBudgetOpen] = useState(true);
  const budgetButton = useRef<HTMLButtonElement>(null);
  const commandButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<() => HTMLElement | null>(undefined);
  const range = customRange ?? monthRange(month);
  const {
    data: metadata,
    isError: metadataFailed,
    error: metadataError,
    refetch: refetchMetadata,
  } = useQuery({
    queryKey: ['metadata'],
    queryFn: ({signal}) => session.source.metadata(signal),
  });
  const load = useTransactionPages(session, range);
  const {data: allRows = []} = useLiveQuery(session.rows);
  const edits = useEdits(session, allRows);
  const postedRows = useMemo(
    () => edits.rows.filter(row => !row.is_pending),
    [edits.rows],
  );
  const choices = useMemo<Record<Facet, readonly Choice[]>>(
    () => ({
      review: reviews,
      category: metadata?.categories ?? [],
      tag: metadata?.tags.toSorted((a, b) => a.label.localeCompare(b.label)) ?? [],
      account: metadata?.accounts ?? [],
    }),
    [metadata],
  );
  const lookUp = (facet: Facet, id: string) =>
    choices[facet].find(choice => choice.id === id)?.label ?? id;
  const view = useTransactionView(postedRows, range, metadata);
  const {filters, search, sort, gridSort, visible} = view;
  const palette = surface?.kind === 'palette' ? surface : undefined;
  const overlay = palette?.overlay;
  const rowEditor =
    surface?.kind === 'inline' || surface?.kind === 'cell' ? surface : undefined;
  const editorRow = rowEditor && visible.find(row => row.id === rowEditor.id);
  const inlineEditor = editorRow && rowEditor?.kind === 'inline' ? rowEditor : undefined;
  const cellEditor = editorRow && rowEditor?.kind === 'cell' ? rowEditor : undefined;
  const suspended = Boolean(palette) || Boolean(editorRow);
  const grid = useTransactionGrid(visible, suspended, commandButton);
  const {focusedRow, selectedRows} = grid;

  useLayoutEffect(() => {
    grid.endRange();
  }, [sort?.column, sort?.direction]);

  useLayoutEffect(() => {
    if (rowEditor && !editorRow) {
      setSurface(current => (current === rowEditor ? undefined : current));
    }
  }, [rowEditor, editorRow]);

  useLayoutEffect(() => {
    if (suspended || !pendingFocus.current) {
      return;
    }
    const restore = pendingFocus.current;
    pendingFocus.current = undefined;
    grid.focusTarget(restore());
  }, [suspended]);
  // TODO: Index historical payees per budget and persist the index and sync cursor in IndexedDB.
  const payees = useMemo(
    () => [...new Set(postedRows.map(row => row.payee))].sort(),
    [postedRows],
  );
  const overlayTargets =
    overlay?.kind === 'edit'
      ? overlay.ids.flatMap(id => {
          const row = session.rows.get(id);
          return row ? [row] : [];
        })
      : [];

  function restoreFocus() {
    const origin = palette?.origin;
    if (origin?.element?.isConnected) {
      return origin.element;
    }

    return (
      grid.rowElement(origin?.rowId) ??
      grid.rowElement(grid.active) ??
      commandButton.current
    );
  }

  function open(next: Overlay) {
    const origin = palette?.origin ?? {
      element:
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
      rowId: grid.focusedTransaction()?.id,
    };
    setSurface({kind: 'palette', overlay: next, origin});
  }

  function close() {
    pendingFocus.current = restoreFocus;
    setSurface(current => (current === palette ? undefined : current));
  }

  function go(next: string) {
    setMonth(next);
    setCustomRange(undefined);
    grid.reset();
    if (palette) {
      close();
    } else {
      setSurface(undefined);
    }
  }

  function toggleBudget() {
    if (budgetOpen && document.activeElement?.closest('#monthly-budget')) {
      budgetButton.current?.focus({preventScroll: true});
    }
    setBudgetOpen(open => !open);
  }

  function clearFilters() {
    view.clearFilters();
    if (overlay) {
      close();
    }
  }

  function changeRows(label: string, rows: Row[], patch: RowPatch) {
    if (overlay) {
      close();
    }
    edits.save({
      label,
      changes: rows.flatMap(row => {
        const change = draftChange(row, typeof patch === 'function' ? patch(row) : patch);
        return change ? [change] : [];
      }),
    });
  }

  function showEditor(field: Field, rows: Row[]) {
    if (!rows.length) {
      return;
    }

    if (rows.length === 1 && !palette) {
      const [{id}] = rows;
      const anchor = grid.cellElement(id, field);
      if (anchor) {
        anchor.scrollIntoView({block: 'nearest', inline: 'nearest'});
        setSurface(
          isCellEditorField(field)
            ? {kind: 'cell', id, field, anchor}
            : {kind: 'inline', id, field},
        );
        return;
      }
    }

    open({kind: 'edit', field, ids: rows.map(row => row.id)});
  }

  function closeCellEditor(restoreRowFocus: boolean) {
    if (!cellEditor) {
      return;
    }

    setSurface(current => (current === cellEditor ? undefined : current));
    if (restoreRowFocus) {
      pendingFocus.current = () =>
        grid.rowElement(cellEditor.id) ?? commandButton.current;
    }
  }

  function review(status: ReviewStatus, rows: Row[]) {
    const candidates = reviewTargets(rows, status);
    if (!candidates.length) {
      return;
    }

    changeRows(
      status === 'reviewed' ? 'Marked reviewed' : 'Marked unreviewed',
      candidates,
      {status},
    );
  }

  const shortcutsEnabled = !suspended && letterKeys;
  const gridKeys = shortcutsEnabled && grid.hasFocus;
  const canNavigateRows = !suspended && visible.length > 0;
  const rowNavigationKeys = canNavigateRows && letterKeys;
  const enterGridKeys = canNavigateRows && !grid.hasFocus;
  const readyForEdit = !load.isPending;
  function keyboardTargets() {
    const row = grid.focusedTransaction();
    if (row) {
      return selectedRows.length ? selectedRows : [row];
    }
    return grid.hasFocus ? selectedRows : [];
  }
  useHotkeys([
    {
      hotkey: 'Mod+K',
      callback: () => open({kind: 'commands'}),
      options: {enabled: !suspended},
    },
    {
      hotkey: 'Mod+Z',
      callback: () => edits.replay('undo'),
      options: {enabled: edits.canUndo && !suspended},
    },
    {
      hotkey: 'Mod+Shift+Z',
      callback: () => edits.replay('redo'),
      options: {enabled: edits.canRedo && !suspended},
    },
    {
      hotkey: 'S',
      callback: () => open({kind: 'sort'}),
      options: {enabled: shortcutsEnabled},
    },
    {
      hotkey: 'F',
      callback: () => open({kind: 'filters'}),
      options: {enabled: shortcutsEnabled},
    },
    {hotkey: ']', callback: toggleBudget, options: {enabled: shortcutsEnabled}},
    {hotkey: 'Control+F', callback: clearFilters, options: {enabled: shortcutsEnabled}},
    {
      hotkey: 'Escape',
      callback: event => {
        if (grid.escape()) {
          event.preventDefault();
        }
      },
      options: {enabled: !suspended, preventDefault: false, stopPropagation: false},
    },
    {
      hotkey: 'Shift+/',
      callback: () => open({kind: 'shortcuts'}),
      options: {enabled: shortcutsEnabled},
    },
    {
      hotkey: ['G', 'N'],
      callback: () => go(shiftMonth(month, 1)),
      options: {enabled: shortcutsEnabled},
    },
    {
      hotkey: ['G', 'P'],
      callback: () => go(shiftMonth(month, -1)),
      options: {enabled: shortcutsEnabled},
    },
    {
      hotkey: ['G', 'T'],
      callback: () => go(currentMonth()),
      options: {enabled: shortcutsEnabled},
    },
    {
      hotkey: ['G', 'M'],
      callback: () => open({kind: 'month'}),
      options: {enabled: shortcutsEnabled},
    },
    {
      hotkey: ['G', 'G'],
      callback: () => grid.jumpToEdge('first'),
      options: {enabled: rowNavigationKeys},
    },
    {
      hotkey: 'Shift+G',
      callback: () => grid.jumpToEdge('last'),
      options: {enabled: rowNavigationKeys},
    },
    {
      hotkey: 'ArrowDown',
      callback: () => grid.move(1),
      options: {enabled: enterGridKeys},
    },
    {hotkey: 'ArrowUp', callback: () => grid.move(-1), options: {enabled: enterGridKeys}},
    {
      hotkey: 'Control+D',
      callback: () => grid.move(1, false, 0.5),
      options: {enabled: canNavigateRows, ignoreInputs: true},
    },
    {
      hotkey: 'Control+U',
      callback: () => grid.move(-1, false, 0.5),
      options: {enabled: canNavigateRows, ignoreInputs: true},
    },
    {hotkey: 'J', callback: () => grid.move(1), options: {enabled: rowNavigationKeys}},
    {hotkey: 'K', callback: () => grid.move(-1), options: {enabled: rowNavigationKeys}},
    {hotkey: 'Shift+J', callback: () => grid.move(1, true), options: {enabled: gridKeys}},
    {
      hotkey: 'Shift+K',
      callback: () => grid.move(-1, true),
      options: {enabled: gridKeys},
    },
    {hotkey: 'X', callback: grid.toggleFocused, options: {enabled: gridKeys}},
    {hotkey: 'Shift+X', callback: grid.extendToFocused, options: {enabled: gridKeys}},
    {
      hotkey: reviewShortcut,
      callback: () => {
        const rows = keyboardTargets();
        review(reviewStatusFor(rows), rows);
      },
      options: {enabled: shortcutsEnabled && readyForEdit},
    },
    ...Object.values(editActions).map(({field, key}) => ({
      hotkey: key,
      callback: () => showEditor(field, keyboardTargets()),
      options: {enabled: shortcutsEnabled && readyForEdit},
    })),
  ]);

  const clearFiltersCommand = tableCommand('clear', clearFilters);
  const globalCommands = [
    tableCommand('filter', () => open({kind: 'filters'}), {
      items: buildFilterCommands,
      search: 'inline',
    }),
    clearFiltersCommand,
    tableCommand('sort', () => open({kind: 'sort'}), {
      items: buildSortCommands,
      search: 'inline',
    }),
    tableCommand('search', () => open({kind: 'search'})),
    tableCommand('previous', () => go(shiftMonth(month, -1))),
    tableCommand('next', () => go(shiftMonth(month, 1))),
    tableCommand('month', () => open({kind: 'month'})),
    tableCommand('current', () => go(currentMonth())),
    ...(edits.canUndo
      ? [
          tableCommand('undo', () => {
            close();
            edits.replay('undo');
          }),
        ]
      : []),
    ...(edits.canRedo
      ? [
          tableCommand('redo', () => {
            close();
            edits.replay('redo');
          }),
        ]
      : []),
  ];

  function commandTargets() {
    if (selectedRows.length) {
      return selectedRows;
    }
    return palette
      ? visible.filter(row => row.id === palette.origin.rowId)
      : focusedRow
        ? [focusedRow]
        : [];
  }

  const actionRows = commandTargets();
  const commandItems = readyForEdit
    ? transactionCommands(
        actionRows,
        field => showEditor(field, actionRows),
        status => review(status, actionRows),
      )
    : [];

  function chooseFacet(facet: MultiValueFacet, id: string) {
    view.chooseFacet(facet, id);
    close();
  }

  function buildFilterCommands() {
    return filterCommands(
      choices,
      filters,
      {
        openFacet: facet => open({kind: 'facet', facet}),
        chooseFacet,
        toggleFacet: view.toggleFacet,
        chooseReview: status => {
          view.setReview(status);
          close();
        },
      },
      clearFiltersCommand,
    );
  }

  function buildSortCommands() {
    return sortCommands(gridSort, Boolean(search), sort => {
      view.setSort(sort);
      close();
    });
  }

  function finishInline(value?: string, restore = true) {
    if (!inlineEditor) {
      return;
    }
    const {id, field} = inlineEditor;
    setSurface(current => (current === inlineEditor ? undefined : current));
    const row = editorRow;
    if (value !== undefined && row) {
      if (field === 'payee') {
        changeRows('Changed payee', [row], {payee: value});
      } else {
        changeRows('Changed note', [row], {notes: value});
      }
    }
    if (restore) {
      pendingFocus.current = () => grid.rowElement(id) ?? commandButton.current;
    }
  }

  const modal = overlay && renderOverlay(overlay);

  function renderOverlay(current: Overlay) {
    switch (current.kind) {
      case 'commands':
        return {
          title: 'Commands',
          body: <CommandList items={[...commandItems, ...globalCommands]} />,
        };
      case 'sort':
        return {
          title: 'Sort by',
          back: () => open({kind: 'commands'}),
          body: <CommandList items={buildSortCommands()} />,
        };
      case 'filters':
        return {
          title: 'Filter',
          back: () => open({kind: 'commands'}),
          body: <CommandList items={buildFilterCommands()} />,
        };
      case 'facet': {
        const {facet} = current;
        const checked = filters[facet];
        const items = choices[facet].map(choice => ({
          ...choice,
          mark: checked.includes(choice.id) ? ('checked' as const) : undefined,
        }));

        return {
          title: `Filter by ${facetLabels[facet].toLowerCase()}`,
          back: () => open({kind: 'filters'}),
          body: (
            <Picker
              title={`Search ${facetLabels[facet].toLowerCase()}`}
              items={items}
              choose={id => chooseFacet(facet, id)}
              modifierToggle={id => view.toggleFacet(facet, id)}
              footer={
                <>
                  <small>⌘Enter / Ctrl+Enter toggles values</small>
                  <button type="button" onClick={close}>
                    Done
                  </button>
                </>
              }
            />
          ),
        };
      }
      case 'month':
        return {
          title: 'Go to month',
          body: (
            <Picker
              title="Search months"
              items={Array.from({length: 180}, (_, index) => {
                const id = shiftMonth(currentMonth(), 12 - index);
                return {id, label: monthLabel(id), aliases: [id]};
              })}
              choose={go}
            />
          ),
        };
      case 'search':
        return {
          title: 'Search',
          body: (
            <SearchEditor
              value={search}
              count={visible.length}
              range={range}
              pending={load.isPending}
              update={view.setSearch}
              done={close}
              wider={() => open({kind: 'range'})}
            />
          ),
        };
      case 'range':
        return {
          title: 'Search a wider date range',
          back: () => open({kind: 'search'}),
          body: (
            <RangeEditor
              range={range}
              apply={next => {
                setCustomRange(next);
                grid.reset();
                open({kind: 'search'});
              }}
            />
          ),
        };
      case 'connect':
        return {
          title: 'Connect Lunch Money',
          body: <Connect connect={connect} live={live} />,
        };
      case 'shortcuts':
        return {
          title: 'Keyboard shortcuts',
          body: (
            <div className={ui.editor}>
              <dl className={ui.descriptionList}>
                <dt>Move between rows</dt>
                <dd>↑ / ↓ or J / K</dd>
                <dt>Move between columns</dt>
                <dd>← / → or Tab / Shift+Tab</dd>
                <dt>Jump half a page up / down</dt>
                <dd>Ctrl+U / Ctrl+D</dd>
                <dt>First / last row</dt>
                <dd>G G / Shift+G</dd>
                <dt>Select row or range</dt>
                <dd>X, Shift+X, Shift+J/K, Shift+↑/↓</dd>
                <dt>Select visible results</dt>
                <dd>⌘A / Ctrl+A</dd>
                <dt>Edit fields</dt>
                <dd>C category, P payee, D date, N note, T tags</dd>
                <dt>Review</dt>
                <dd>R</dd>
                <dt>Toggle monthly budget</dt>
                <dd>]</dd>
                <dt>Sort by</dt>
                <dd>S</dd>
                <dt>Filters</dt>
                <dd>F open, Ctrl+F clear</dd>
                <dt>Months</dt>
                <dd>G N next, G P previous, G M go to month, G T current</dd>
                <dt>Clear focus or selection</dt>
                <dd>Esc</dd>
                <dt>Commands</dt>
                <dd>⌘K / Ctrl+K</dd>
                <dt>Move through command results</dt>
                <dd>↑ / ↓ or Ctrl+P / Ctrl+N</dd>
                <dt>Undo / redo</dt>
                <dd>⌘Z / ⌘⇧Z or Ctrl equivalents</dd>
              </dl>
              <label>
                <input
                  type="checkbox"
                  checked={letterKeys}
                  onChange={event => setLetterKeys(event.target.checked)}
                />{' '}
                Single-letter shortcuts
              </label>
            </div>
          ),
        };
      case 'edit': {
        const {field} = current;
        return {
          title: overlayTargets.length
            ? `${editTitle(field, overlayTargets.length > 1)} · ${transactionCountLabel(overlayTargets.length)}`
            : 'Transaction unavailable',
          body: (
            <TransactionEditor
              field={field}
              rows={overlayTargets}
              metadata={metadata}
              payees={payees}
              save={(label, patch) => changeRows(label, overlayTargets, patch)}
              close={close}
            />
          ),
        };
      }
    }
  }

  return (
    <>
      <header className={styles.top}>
        <strong>Pounce</strong>
        <span>{live ? 'Lunch Money' : 'Sample data'}</span>
        <button type="button" onClick={() => open({kind: 'connect'})}>
          {live ? 'Connection' : 'Connect Lunch Money'}
        </button>
        <button type="button" onClick={() => open({kind: 'shortcuts'})}>
          Shortcuts <kbd>?</kbd>
        </button>
        <button
          type="button"
          ref={commandButton}
          onClick={() => open({kind: 'commands'})}
        >
          <Command className={ui.actionIcon} aria-hidden />
          Commands <kbd>⌘K</kbd>
        </button>
      </header>
      <main className={styles.layout}>
        <section className={styles.workspace} aria-labelledby="title">
          <h1 id="title">Transactions</h1>
          <div className={`${ui.controls} ${styles.transactionToolbar}`}>
            <button
              type="button"
              onClick={() => go(shiftMonth(month, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className={ui.actionIcon} aria-hidden />
            </button>
            <button type="button" onClick={() => open({kind: 'month'})}>
              {monthLabel(month)}
            </button>
            <button
              type="button"
              onClick={() => go(shiftMonth(month, 1))}
              aria-label="Next month"
            >
              <ChevronRight className={ui.actionIcon} aria-hidden />
            </button>
            <button type="button" onClick={() => open({kind: 'filters'})}>
              <FilterIcon className={ui.actionIcon} aria-hidden />
              Filter
            </button>
            <button type="button" onClick={() => open({kind: 'search'})}>
              <Search className={ui.actionIcon} aria-hidden />
              Search
            </button>
            <button
              ref={budgetButton}
              type="button"
              aria-expanded={budgetOpen}
              aria-controls="monthly-budget"
              aria-keyshortcuts="]"
              onClick={toggleBudget}
            >
              <Wallet className={ui.actionIcon} aria-hidden />
              Budget
            </button>
            {selectedRows.length > 0 && (
              <div className={styles.selectionToolbar}>
                <span role="status">
                  {transactionCountLabel(selectedRows.length)} selected
                </span>
                <button type="button" onClick={() => open({kind: 'commands'})}>
                  Selection actions
                </button>
                <button type="button" onClick={grid.clearSelection}>
                  Clear selection
                </button>
              </div>
            )}
          </div>
          <div className={`${ui.controls} ${styles.chips}`} aria-label="Active filters">
            {view.activeFilters.map(({facet, id}) => (
              <button
                type="button"
                key={facet + id}
                onClick={() => view.toggleFacet(facet, id)}
                aria-label={`Remove filter ${lookUp(facet, id)}`}
              >
                {lookUp(facet, id)} ×
              </button>
            ))}
            {search && (
              <button
                type="button"
                onClick={() => view.setSearch('')}
                aria-label="Clear search"
              >
                Search: {search} ×
              </button>
            )}
            {customRange && (
              <button
                type="button"
                onClick={() => go(month)}
                aria-label="Return to month"
              >
                {range.start} – {range.end} ×
              </button>
            )}
          </div>
          {metadataFailed && (
            <p role="alert">
              {message(metadataError)}{' '}
              <button type="button" onClick={() => void refetchMetadata()}>
                Retry metadata
              </button>
            </p>
          )}
          {load.isError && (
            <p role="alert">
              {message(load.error)}{' '}
              <button type="button" onClick={() => void load.retry()}>
                Retry transactions
              </button>
            </p>
          )}
          <Grid
            rows={visible}
            sort={gridSort}
            onSort={view.setSort}
            interaction={grid}
            open={(field, row) => showEditor(field, [row])}
            cellEditorHandle={cellEditorHandle}
            inlineEditor={
              inlineEditor && {
                ...inlineEditor,
                payees,
                apply: finishInline,
                cancel: () => finishInline(),
                leave: value => finishInline(value, false),
              }
            }
            metadata={metadata}
            loading={load.isPending}
          />
          <footer className={`${ui.controls} ${styles.status}`}>
            <span role="status">
              {edits.busy
                ? 'Saving…'
                : load.isPending
                  ? 'Loading transactions…'
                  : transactionCountLabel(visible.length)}
            </span>
            {edits.canUndo && (
              <button type="button" onClick={() => edits.replay('undo')}>
                Undo
              </button>
            )}
            {edits.canRedo && (
              <button type="button" onClick={() => edits.replay('redo')}>
                Redo
              </button>
            )}
          </footer>
          {edits.issues.length > 0 && (
            <div className={styles.warning} role="alert">
              <button type="button" onClick={edits.clearIssues}>
                Dismiss
              </button>
              {edits.issues.map(issue => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          )}
        </section>
        <Budget
          session={session}
          month={month}
          metadata={metadata}
          hidden={!budgetOpen}
        />
      </main>
      <Popover.Root
        handle={cellEditorHandle}
        open={Boolean(cellEditor)}
        triggerId={
          cellEditor ? cellEditorTriggerId(cellEditor.field, cellEditor.id) : null
        }
        onOpenChange={(open, {trigger, reason}) => {
          if (!open) {
            closeCellEditor(reason === 'escape-key');
            return;
          }

          const cell = trigger?.closest<HTMLElement>('[data-editor-cell]');
          const field = cell?.dataset.editorCell;
          const id = cell?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
          const row = visible.find(row => row.id === Number(id));
          if (row && isCellEditorField(field)) {
            showEditor(field, [row]);
          }
        }}
      >
        {cellEditor && editorRow && (
          <Popover.Portal>
            <Popover.Positioner
              anchor={cellEditor.anchor}
              align="start"
              sideOffset={4}
              className={paletteStyles.cellEditorPositioner}
            >
              <Popover.Popup
                className={paletteStyles.cellEditorPopup}
                aria-label={editTitle(cellEditor.field, false)}
                initialFocus={false}
                finalFocus={false}
              >
                <TransactionEditor
                  key={cellEditor.field + cellEditor.id}
                  field={cellEditor.field}
                  rows={[editorRow]}
                  metadata={metadata}
                  payees={payees}
                  close={() => closeCellEditor(true)}
                  save={(label, patch) => {
                    closeCellEditor(true);
                    changeRows(label, [editorRow], patch);
                  }}
                />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        )}
      </Popover.Root>
      {modal && overlay && (
        <Modal title={modal.title} close={close} restore={restoreFocus} back={modal.back}>
          <div
            key={
              overlay.kind === 'facet'
                ? `facet:${overlay.facet}`
                : overlay.kind === 'edit'
                  ? `edit:${overlay.field}`
                  : overlay.kind
            }
          >
            {modal.body}
          </div>
        </Modal>
      )}
    </>
  );
}

function SearchEditor({
  value,
  update,
  done,
  wider,
  range,
  count,
  pending,
}: {
  value: string;
  update: (value: string) => void;
  done: () => void;
  wider: () => void;
  range: Range;
  count: number;
  pending: boolean;
}) {
  const input = useInitialFocus<HTMLInputElement>();
  return (
    <form
      className={ui.editor}
      onSubmit={event => {
        event.preventDefault();
        done();
      }}
    >
      <label>
        Payee, bank descriptor, or notes
        <input ref={input} value={value} onChange={event => update(event.target.value)} />
      </label>
      <p role="status">
        {range.start} – {range.end} ·{' '}
        {pending ? 'Loading…' : transactionCountLabel(count)}
      </p>
      <div className={ui.controls}>
        <button type="submit">Show results</button>
        <button type="button" onClick={wider}>
          Search a wider date range
        </button>
      </div>
    </form>
  );
}

function Connect({connect, live}: {connect: (token?: string) => void; live: boolean}) {
  const [token, setToken] = useState('');
  return (
    <form
      className={ui.editor}
      onSubmit={event => {
        event.preventDefault();
        if (token.trim()) {
          connect(token.trim());
        }
      }}
    >
      <label>
        Lunch Money API token
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={event => setToken(event.target.value)}
        />
      </label>
      <p>
        This browser saves your token for this site and sends it directly to Lunch Money.
        Disconnect clears the saved token.
      </p>
      <div className={ui.controls}>
        <button type="submit" disabled={!token.trim()}>
          Connect
        </button>
        {live && (
          <button type="button" onClick={() => connect()}>
            Disconnect
          </button>
        )}
      </div>
    </form>
  );
}
