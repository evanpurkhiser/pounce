import {ArrowDownUp, CalendarDays, ChevronLeft, ChevronRight, Command, DollarSign, Filter as FilterIcon, Redo2, Search, Undo2, Wallet, X} from 'lucide-react';
import {Toaster, toast} from 'sonner';
import {Popover} from '@base-ui/react/popover';
import {useLiveQuery} from '@tanstack/react-db';
import {QueryClientProvider, useQuery} from '@tanstack/react-query';
import {useHotkeys} from '@tanstack/react-hotkeys';
import {createParser, parseAsNativeArrayOf, parseAsString, parseAsStringLiteral, useQueryStates} from 'nuqs';
import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {accountKey, currentMonth, inRange, liveSource, monthLabel, monthRange, shiftMonth, type Choice, type Range, type Row} from './api';
import {Budget} from './Budget';
import {createSession, message, type Session} from './data';
import {RangeEditor} from './Editors';
import {Grid} from './Grid';
import type {CommandItem} from './commandSearch';
import {CommandList, Modal, Picker, useInitialFocus} from './Palette';
import {rank} from './search';
import {columns, defaultSort, sortTransactions, type SortDescriptor} from './sorting';
import {TransactionEditor, type RowPatch} from './TransactionEditor';
import {cellEditorTriggerId, editActions, editTitle, isCellEditorField, reviewIcons, reviewShortcut, reviewStatuses, reviewTargets, type CellEditorField, type Field, type ReviewStatus} from './transactionActions';
import {demoSource} from './transactions';
import {useEdits} from './useEdits';
import {useTransactionGrid} from './useTransactionGrid';
import {useTransactionPages} from './useTransactionPages';
import styles from './App.module.css';
import paletteStyles from './Palette.module.css';
import ui from './ui.module.css';

const facets = ['review', 'category', 'tag', 'account'] as const;
type Facet = typeof facets[number];
type Overlay =
  | {kind: 'commands' | 'sort' | 'filters' | 'month' | 'search' | 'range' | 'shortcuts' | 'connect'}
  | {kind: 'facet'; facet: Facet}
  | {kind: 'edit'; field: Field; ids: number[]};

const filterIds = parseAsNativeArrayOf(createParser({
  parse: value => /^\d+$/.test(value) ? value : null,
  serialize: (value: string) => value,
}));
const viewParams = {
  review: parseAsStringLiteral(reviewStatuses),
  category: filterIds,
  tag: filterIds,
  account: parseAsNativeArrayOf(createParser({
    parse: value => /^(?:cash|(?:manual|plaid):\d+)$/.test(value) ? value : null,
    serialize: (value: string) => value,
  })),
  q: parseAsString.withDefault('').withOptions({history: 'replace'}),
  sort: createParser<SortDescriptor>({
    parse(value) {
      const [id, direction, ...extra] = value.split(':');
      const column = columns.find(item => item.id === id)?.id;
      if (!column || extra.length || (direction !== 'ascending' && direction !== 'descending')) return null;

      return {column, direction};
    },
    serialize: ({column, direction}) => column + ':' + direction,
    eq: (left, right) => left.column === right.column && left.direction === right.direction,
  }),
};

const facetLabels: Record<Facet, string> = {review: 'Review status', category: 'Category', tag: 'Tag', account: 'Account'};
const facetIcons = {category: editActions.category.icon, tag: editActions.tags.icon, account: Wallet};
const reviews = [{id: 'unreviewed', label: 'Unreviewed'}, {id: 'reviewed', label: 'Reviewed'}, {id: '', label: 'Any review status'}] as const;
const tableIcons: Record<string, CommandItem['icon']> = {
  filter: FilterIcon, clear: X, sort: ArrowDownUp, search: Search,
  previous: ChevronLeft, next: ChevronRight, month: CalendarDays, current: CalendarDays, undo: Undo2, redo: Redo2,
};
const countLabel = (count: number) => count + (count === 1 ? ' transaction' : ' transactions');

const tokenStorageKey = 'lunchline.lunchMoneyToken';

function readToken() {
  try {
    return localStorage.getItem(tokenStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function createConnection(id: number, token?: string) {
  return {session: createSession(token ? liveSource(token) : demoSource()), live: !!token, id};
}

export function App() {
  const [connection, setConnection] = useState(() => createConnection(0, readToken()));

  function connect(token?: string) {
    try {
      if (token) localStorage.setItem(tokenStorageKey, token);
      else localStorage.removeItem(tokenStorageKey);
    } catch {
      if (token) toast.warning('The browser could not save the key. This connection lasts until reload.');
      else toast.warning('The browser could not clear the saved key.');
    }

    setConnection(previous => createConnection(previous.id + 1, token));
  }

  return <QueryClientProvider client={connection.session.query}>
    <Workspace key={connection.id} {...connection} connect={connect} />
    <Toaster richColors position="bottom-right" />
  </QueryClientProvider>;
}

function Workspace({session, live, connect}: {session: Session; live: boolean; connect: (token?: string) => void}) {
  const [month, setMonth] = useState(currentMonth);
  const [customRange, setCustomRange] = useState<Range>();
  const [{review: reviewFilter, category, tag, account, q: search, sort}, setView] = useQueryStates(viewParams, {history: 'push'});
  const filters = useMemo<Record<Facet, readonly string[]>>(() => ({review: reviewFilter ? [reviewFilter] : [], category, tag, account}),
    [reviewFilter, category, tag, account]);
  const gridSort = sort ?? (search ? undefined : defaultSort);
  const [overlay, setOverlay] = useState<Overlay>();
  const [cellEditor, setCellEditor] = useState<{id: number; field: CellEditorField; anchor: HTMLElement}>();
  const [cellEditorHandle] = useState(() => Popover.createHandle());
  const [inlineEditor, setInlineEditor] = useState<{id: number; field: 'payee' | 'note'}>();
  const [letterKeys, setLetterKeys] = useState(true);
  const [budgetOpen, setBudgetOpen] = useState(true);
  const budgetButton = useRef<HTMLButtonElement>(null);
  const commandButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<() => HTMLElement | null>(undefined);
  const originRow = useRef<number | undefined>(undefined);
  const edits = useEdits(session);
  const range = customRange ?? monthRange(month);
  const {data: metadata, isError: metadataFailed, error: metadataError, refetch: refetchMetadata} = useQuery({
    queryKey: ['metadata'], queryFn: ({signal}) => session.source.metadata(signal),
  });
  const load = useTransactionPages(session, range);
  const {data: allRows = []} = useLiveQuery(session.rows);
  const postedRows = useMemo(() => allRows.filter(row => !row.is_pending), [allRows]);
  const choices = useMemo<Record<Facet, readonly Choice[]>>(() => ({
    review: reviews, category: metadata?.categories ?? [],
    tag: metadata?.tags.toSorted((a, b) => a.label.localeCompare(b.label)) ?? [], account: metadata?.accounts ?? [],
  }), [metadata]);
  const lookUp = (facet: Facet, id: string) => choices[facet].find(choice => choice.id === id)?.label ?? id;
  const visible = useMemo(() => {
    const ranged = postedRows.filter(row => inRange(row.date, range));
    const matches = ranged.filter(row => {
      const category = row.category_id ?? 0;
      if (filters.category.length && !filters.category.some(id => +id === category || metadata?.categories.find(item => item.id === id)?.members?.includes(category))) return false;
      if (filters.tag.length && !filters.tag.some(id => row.tag_ids.includes(+id))) return false;
      if (filters.account.length && !filters.account.includes(accountKey(row))) return false;
      return !filters.review.length || filters.review[0] === row.status;
    });
    const ordered = sortTransactions(matches, sort ?? defaultSort, metadata);
    if (!search) return ordered;
    const results = rank(ordered.map(row => ({row, label: row.payee, aliases: [row.original_name ?? '', row.notes ?? '']})), search).map(item => item.row);
    return sort ? sortTransactions(results, sort, metadata) : results;
  }, [postedRows, filters, metadata, range.start, range.end, search, sort]);
  const cellEditorRow = cellEditor && visible.find(row => row.id === cellEditor.id);
  const suspended = !!overlay || !!cellEditorRow || !!inlineEditor;
  const grid = useTransactionGrid(visible, suspended, commandButton);
  const {focusedRow, selectedRows} = grid;

  useLayoutEffect(() => {
    grid.endRange();
  }, [sort?.column, sort?.direction]);

  useLayoutEffect(() => {
    if (suspended || !pendingFocus.current) return;
    const restore = pendingFocus.current;
    pendingFocus.current = undefined;
    grid.focusTarget(restore());
  }, [suspended]);
  // TODO: Index historical payees per budget and persist the index and sync cursor in IndexedDB.
  const payees = useMemo(() => [...new Set(postedRows.map(row => row.payee))].sort(), [postedRows]);
  const overlayTargets = overlay?.kind === 'edit' ? overlay.ids.flatMap(id => {
    const row = session.rows.get(id);
    return row ? [row] : [];
  }) : [];

  function restoreFocus() {
    const previous = previousFocus.current;
    if (previous?.isConnected) return previous;
    return grid.rowElement(originRow.current) ?? grid.rowElement(grid.active) ?? commandButton.current;
  }

  function open(next: Overlay) {
    if (!overlay) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      originRow.current = grid.focusedTransaction()?.id;
    }
    setCellEditor(undefined);
    setInlineEditor(undefined);
    setOverlay(next);
  }

  function close() {
    pendingFocus.current = restoreFocus;
    setOverlay(undefined);
  }

  function go(next: string) {
    setMonth(next);
    setCustomRange(undefined);
    setInlineEditor(undefined);
    setCellEditor(undefined);
    grid.reset();
    if (overlay) close();
  }

  function changeSort(next?: SortDescriptor) {
    void setView({sort: next ?? null});
  }

  function setSearch(value: string) {
    void setView({q: value});
  }

  function toggleBudget() {
    if (budgetOpen && document.activeElement?.closest('#monthly-budget')) {
      budgetButton.current?.focus({preventScroll: true});
    }
    setBudgetOpen(open => !open);
  }

  function clearFilters() {
    void setView({review: null, category: null, tag: null, account: null, q: null}, {history: 'push'});
    if (overlay) close();
  }

  function toggleFacet(facet: Facet, id: string) {
    if (facet === 'review') {
      void setView({review: null});
      return;
    }

    void setView(previous => {
      const values = previous[facet];
      return {[facet]: values.includes(id) ? values.filter(value => value !== id) : [...values, id]};
    });
  }

  function changeRows(label: string, rows: Row[], patch: RowPatch) {
    if (overlay) close();
    edits.save(label, rows.map(row => ({id: row.id, patch: typeof patch === 'function' ? patch(row) : patch})));
  }

  function showEditor(field: Field, rows: Row[]) {
    if (!rows.length || edits.busy) return;
    if (rows.length === 1 && !overlay) {
      const [row] = rows;
      if (field === 'payee' || field === 'note') {
        grid.rowElement(row.id)?.querySelector('[data-editor-cell="' + field + '"]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
        setInlineEditor({id: row.id, field});
        return;
      }

      const anchor = grid.rowElement(row.id)?.querySelector<HTMLElement>('[data-editor-cell="' + field + '"]');
      if (anchor) {
        anchor.scrollIntoView({block: 'nearest', inline: 'nearest'});
        setCellEditor({id: row.id, field, anchor});
        return;
      }
    }

    open({kind: 'edit', field, ids: rows.map(row => row.id)});
  }

  function closeCellEditor(id: number, restoreRowFocus: boolean) {
    setCellEditor(undefined);
    if (restoreRowFocus) pendingFocus.current = () => grid.rowElement(id) ?? commandButton.current;
  }

  function review(status: ReviewStatus, rows: Row[]) {
    const candidates = reviewTargets(rows, status);
    if (!candidates.length) return;

    changeRows(status === 'reviewed' ? 'Marked reviewed' : 'Marked unreviewed', candidates, {status});
  }

  const shortcutsEnabled = !suspended && letterKeys;
  const gridKeys = shortcutsEnabled && grid.hasFocus;
  const rowNavigationKeys = shortcutsEnabled && visible.length > 0;
  const readyForEdit = !edits.busy && !load.isPending;
  const reviewStatusFor = (rows: Row[]): ReviewStatus => reviewTargets(rows, 'reviewed').length ? 'reviewed' : 'unreviewed';
  function keyboardTargets() {
    const row = grid.focusedTransaction();
    if (row) return selectedRows.length ? selectedRows : [row];
    return grid.hasFocus ? selectedRows : [];
  }
  useHotkeys([
    {hotkey: 'Mod+K', callback: () => open({kind: 'commands'}), options: {enabled: !suspended}},
    {hotkey: 'Mod+Z', callback: () => edits.replay('undo'), options: {enabled: readyForEdit && edits.canUndo && !suspended}},
    {hotkey: 'Mod+Shift+Z', callback: () => edits.replay('redo'), options: {enabled: readyForEdit && edits.canRedo && !suspended}},
    {hotkey: 'S', callback: () => open({kind: 'sort'}), options: {enabled: shortcutsEnabled}},
    {hotkey: 'F', callback: () => open({kind: 'filters'}), options: {enabled: shortcutsEnabled}},
    {hotkey: ']', callback: toggleBudget, options: {enabled: shortcutsEnabled}},
    {hotkey: 'Control+F', callback: clearFilters, options: {enabled: shortcutsEnabled}},
    {hotkey: 'Escape', callback: event => { if (grid.escape()) event.preventDefault(); },
      options: {enabled: !suspended, preventDefault: false, stopPropagation: false}},
    {hotkey: 'Shift+/', callback: () => open({kind: 'shortcuts'}), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'N'], callback: () => go(shiftMonth(month, 1)), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'P'], callback: () => go(shiftMonth(month, -1)), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'T'], callback: () => go(currentMonth()), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'M'], callback: () => open({kind: 'month'}), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'G'], callback: () => grid.jumpToEdge('first'), options: {enabled: rowNavigationKeys}},
    {hotkey: 'Shift+G', callback: () => grid.jumpToEdge('last'), options: {enabled: rowNavigationKeys}},
    {hotkey: 'J', callback: () => grid.move(1), options: {enabled: rowNavigationKeys}},
    {hotkey: 'K', callback: () => grid.move(-1), options: {enabled: rowNavigationKeys}},
    {hotkey: 'Shift+J', callback: () => grid.move(1, true), options: {enabled: gridKeys}},
    {hotkey: 'Shift+K', callback: () => grid.move(-1, true), options: {enabled: gridKeys}},
    {hotkey: 'X', callback: grid.toggleFocused, options: {enabled: gridKeys}},
    {hotkey: 'Shift+X', callback: grid.extendToFocused, options: {enabled: gridKeys}},
    {hotkey: reviewShortcut, callback: () => {
      const rows = keyboardTargets();
      review(reviewStatusFor(rows), rows);
    }, options: {enabled: shortcutsEnabled && readyForEdit}},
    ...Object.values(editActions).map(({field, key}) => ({
      hotkey: key, callback: () => showEditor(field, keyboardTargets()), options: {enabled: shortcutsEnabled && readyForEdit},
    })),
  ]);

  function tableCommand(id: string, label: string, invoke: () => void, shortcut?: string): CommandItem {
    return {id, label, invoke, shortcut, icon: tableIcons[id], group: 'Table'};
  }

  const clearFiltersCommand = tableCommand('clear', 'Clear filters', clearFilters, 'Ctrl+F');
  const globalCommands: CommandItem[] = [
    {...tableCommand('filter', 'Filter', () => open({kind: 'filters'}), 'F'),
      submenu: {items: filterCommands, search: 'inline'}},
    clearFiltersCommand,
    {...tableCommand('sort', 'Sort by', () => open({kind: 'sort'}), 'S'),
      aliases: ['sort'], submenu: {items: sortCommands, search: 'inline'}},
    tableCommand('search', 'Search', () => open({kind: 'search'})),
    tableCommand('previous', 'Previous month', () => go(shiftMonth(month, -1)), 'G P'),
    tableCommand('next', 'Next month', () => go(shiftMonth(month, 1)), 'G N'),
    tableCommand('month', 'Go to month…', () => open({kind: 'month'}), 'G M'),
    tableCommand('current', 'Go to current month', () => go(currentMonth()), 'G T'),
    ...(!edits.busy && edits.canUndo ? [tableCommand('undo', 'Undo last edit', () => { close(); edits.replay('undo'); }, '⌘Z')] : []),
    ...(!edits.busy && edits.canRedo ? [tableCommand('redo', 'Redo last edit', () => { close(); edits.replay('redo'); }, '⌘⇧Z')] : []),
  ];

  function commandTargets() {
    if (selectedRows.length) return selectedRows;
    return overlay ? visible.filter(row => row.id === originRow.current) : focusedRow ? [focusedRow] : [];
  }

  const actionRows = commandTargets();
  const commandItems: CommandItem[] = readyForEdit && actionRows.length
    ? Object.values(editActions).map(({field, key, icon}) => ({
      id: field, label: editTitle(field, actionRows.length > 1), icon,
      detail: actionRows.length > 1 ? countLabel(actionRows.length) : undefined,
      group: 'Transactions', shortcut: key, invoke: () => showEditor(field, actionRows),
    })) : [];
  if (readyForEdit) for (const status of reviewStatuses) {
    const count = reviewTargets(actionRows, status).length;
    if (count) commandItems.push({id: status, group: 'Transactions', label: 'Mark ' + (actionRows.length > 1 ? count + ' ' : '') + status,
      icon: reviewIcons[status],
      shortcut: status === reviewStatusFor(actionRows) ? reviewShortcut : undefined,
      invoke: () => review(status, actionRows)});
  }

  function isMultiFacet(facet: Facet) {
    return facet === 'category' || facet === 'tag' || facet === 'account';
  }

  function chooseFacet(facet: Facet, id: string) {
    void setView(facet === 'review'
      ? {review: reviewStatuses.find(status => status === id) ?? null}
      : {[facet]: [id]});
    close();
  }

  function filterCommands(): CommandItem[] {
    const activeReview = reviewFilter ?? '';

    return [...facets.flatMap((facet): CommandItem[] => {
      if (facet === 'review') return reviews.filter(item => item.id !== activeReview).map(item => ({
        id: 'review:' + item.id, label: item.label, group: 'Review status',
        icon: item.id ? reviewIcons[item.id] : FilterIcon,
        invoke: () => chooseFacet(facet, item.id),
      }));

      return [{
        id: facet, label: facetLabels[facet], group: 'Filter', icon: facetIcons[facet], invoke: () => open({kind: 'facet', facet}),
        submenu: {
          search: 'inline',
          items: () => choices[facet].map(choice => ({
            ...choice,
            group: facetLabels[facet],
            invoke: () => chooseFacet(facet, choice.id),
            checked: filters[facet].includes(choice.id),
            toggle: isMultiFacet(facet) ? () => toggleFacet(facet, choice.id) : undefined,
          })),
        },
      }];
    }), clearFiltersCommand];
  }

  function sortCommands(): CommandItem[] {
    const items = columns.map(({id, label, directions}): CommandItem => {
      const descending = gridSort?.column === id && gridSort.direction === 'ascending';
      const direction = descending ? 'descending' : 'ascending';
      const detail = directions[descending ? 1 : 0];
      const icon = id === 'amount' ? DollarSign : id === 'review' ? reviewIcons.reviewed : editActions[id].icon;

      return {
        id, label, detail, icon, aliases: [label + ' ' + detail], group: 'Sort by',
        invoke: () => {
          changeSort({column: id, direction});
          close();
        },
      };
    });
    if (search) items.unshift({...tableCommand('relevance', 'Search relevance', () => { changeSort(); close(); }),
      group: 'Sort by', icon: Search, shortcut: gridSort ? undefined : 'Current'});
    return items;
  }

  function finishInline(value?: string, restore = true) {
    if (!inlineEditor) return;
    const {id, field} = inlineEditor;
    setInlineEditor(undefined);
    const row = session.rows.get(id);
    if (value !== undefined && row) {
      if (field === 'payee') changeRows('Changed payee', [row], {payee: value});
      else changeRows('Changed note', [row], {notes: value});
    }
    if (restore) pendingFocus.current = () => grid.rowElement(id) ?? commandButton.current;
  }

  const modal = overlay && renderOverlay(overlay);

  function renderOverlay(current: Overlay) {
    switch (current.kind) {
      case 'commands':
        return {title: 'Commands', body: <CommandList items={[...commandItems, ...globalCommands]} />};
      case 'sort':
        return {title: 'Sort by', back: () => open({kind: 'commands'}), body: <CommandList items={sortCommands()} />};
      case 'filters':
        return {title: 'Filter', back: () => open({kind: 'commands'}), body: <CommandList items={filterCommands()} />};
      case 'facet': {
        const {facet} = current;
        const multi = isMultiFacet(facet);
        const checked = filters[facet];
        const items = choices[facet].map(choice => ({
          ...choice,
          mark: checked.includes(choice.id) ? 'checked' as const : undefined,
        }));

        return {title: 'Filter by ' + facetLabels[facet].toLowerCase(), back: () => open({kind: 'filters'}),
          body: <Picker title={'Search ' + facetLabels[facet].toLowerCase()} items={items}
            choose={id => chooseFacet(facet, id)}
            modifierToggle={multi ? id => toggleFacet(facet, id) : undefined}
            footer={multi && <><small>⌘Enter / Ctrl+Enter toggles values</small><button onClick={close}>Done</button></>} />};
      }
      case 'month':
        return {title: 'Go to month', body: <Picker title="Search months" items={Array.from({length: 180}, (_, index) => {
          const id = shiftMonth(currentMonth(), 12 - index);
          return {id, label: monthLabel(id), aliases: [id]};
        })} choose={go} />};
      case 'search':
        return {title: 'Search', body: <SearchEditor value={search} count={visible.length} range={range} pending={load.isPending}
          update={setSearch} done={close} wider={() => open({kind: 'range'})} />};
      case 'range':
        return {title: 'Search a wider date range', back: () => open({kind: 'search'}), body: <RangeEditor range={range} apply={next => {
          setCustomRange(next); grid.reset(); open({kind: 'search'});
        }} />};
      case 'connect':
        return {title: 'Connect Lunch Money', body: <Connect connect={connect} live={live} />};
      case 'shortcuts':
        return {title: 'Keyboard shortcuts', body: <div className={ui.editor}><dl className={ui.descriptionList}>
          <dt>Move focus</dt><dd>↑ / ↓ or J / K</dd><dt>First / last row</dt><dd>G G / Shift+G</dd>
          <dt>Select row or range</dt><dd>X, Shift+X, Shift+J/K, Shift+↑/↓</dd>
          <dt>Select visible results</dt><dd>⌘A / Ctrl+A</dd><dt>Edit fields</dt><dd>C category, P payee, D date, N note, T tags</dd>
          <dt>Review</dt><dd>R</dd><dt>Toggle monthly budget</dt><dd>]</dd><dt>Sort by</dt><dd>S</dd><dt>Filters</dt><dd>F open, Ctrl+F clear</dd>
          <dt>Months</dt><dd>G N next, G P previous, G M go to month, G T current</dd>
          <dt>Clear focus or selection</dt><dd>Esc</dd>
          <dt>Commands</dt><dd>⌘K / Ctrl+K</dd><dt>Move through command results</dt><dd>↑ / ↓ or Ctrl+P / Ctrl+N</dd><dt>Undo / redo</dt><dd>⌘Z / ⌘⇧Z or Ctrl equivalents</dd>
        </dl><label><input type="checkbox" checked={letterKeys} onChange={event => setLetterKeys(event.target.checked)} /> Single-letter shortcuts</label></div>};
      case 'edit': {
        const {field} = current;
        return {
          title: overlayTargets.length ? editTitle(field, overlayTargets.length > 1) + ' · ' + countLabel(overlayTargets.length) : 'Transaction unavailable',
          body: <TransactionEditor field={field} rows={overlayTargets}
            metadata={metadata} payees={payees} save={(label, patch) => changeRows(label, overlayTargets, patch)} close={close} />,
        };
      }
    }
  }

  return <>
    <header className={styles.top}><strong>Lunchline</strong><span>{live ? 'Lunch Money' : 'Sample data'}</span>
      <button onClick={() => open({kind: 'connect'})}>{live ? 'Connection' : 'Connect Lunch Money'}</button>
      <button onClick={() => open({kind: 'shortcuts'})}>Shortcuts <kbd>?</kbd></button>
      <button ref={commandButton} onClick={() => open({kind: 'commands'})}><Command className={ui.actionIcon} aria-hidden />Commands <kbd>⌘K</kbd></button>
    </header>
    <main className={styles.layout}>
      <section className={styles.workspace} aria-labelledby="title">
        <h1 id="title">Transactions</h1>
        <div className={`${ui.controls} ${styles.transactionToolbar}`}>
          <button onClick={() => go(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className={ui.actionIcon} aria-hidden /></button>
          <button onClick={() => open({kind: 'month'})}>{monthLabel(month)}</button>
          <button onClick={() => go(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight className={ui.actionIcon} aria-hidden /></button>
          <button onClick={() => open({kind: 'filters'})}><FilterIcon className={ui.actionIcon} aria-hidden />Filter</button>
          <button onClick={() => open({kind: 'search'})}><Search className={ui.actionIcon} aria-hidden />Search</button>
          <button ref={budgetButton} type="button" aria-expanded={budgetOpen} aria-controls="monthly-budget"
            aria-keyshortcuts="]" onClick={toggleBudget}><Wallet className={ui.actionIcon} aria-hidden />Budget</button>
          {selectedRows.length > 0 && <div className={styles.selectionToolbar}>
            <span role="status">{countLabel(selectedRows.length)} selected</span>
            <button onClick={() => open({kind: 'commands'})}>Selection actions</button>
            <button onClick={grid.clearSelection}>Clear selection</button>
          </div>}
        </div>
        <div className={`${ui.controls} ${styles.chips}`} aria-label="Active filters">
          {facets.flatMap(facet => filters[facet].map(id => <button key={facet + id}
            onClick={() => toggleFacet(facet, id)} aria-label={'Remove filter ' + lookUp(facet, id)}>{lookUp(facet, id)} ×</button>))}
          {search && <button onClick={() => setSearch('')} aria-label="Clear search">Search: {search} ×</button>}
          {customRange && <button onClick={() => go(month)} aria-label="Return to month">{range.start} – {range.end} ×</button>}
        </div>
        {metadataFailed && <p role="alert">{message(metadataError)} <button onClick={() => void refetchMetadata()}>Retry metadata</button></p>}
        {load.isError && <p role="alert">{message(load.error)} <button onClick={() => void load.retry()}>Retry transactions</button></p>}
        <Grid rows={visible} sort={gridSort} onSort={changeSort} interaction={grid}
          open={(field, row) => showEditor(field, [row])}
          cellEditorHandle={cellEditorHandle}
          inlineEditor={inlineEditor && {
            ...inlineEditor,
            payees,
            apply: finishInline,
            cancel: () => finishInline(),
            leave: value => finishInline(value, false),
          }} metadata={metadata} loading={load.isPending} />
        <footer className={`${ui.controls} ${styles.status}`}>
          <span role="status">{edits.busy ? 'Saving…' : load.isPending ? 'Loading transactions…' : countLabel(visible.length)}</span>
          {edits.canUndo && <button disabled={edits.busy} onClick={() => edits.replay('undo')}>Undo</button>}
          {edits.canRedo && <button disabled={edits.busy} onClick={() => edits.replay('redo')}>Redo</button>}
        </footer>
        {edits.issues.length > 0 && <div className={styles.warning} role="alert"><button onClick={edits.clearIssues}>Dismiss</button>
          {edits.issues.map(issue => <p key={issue}>{issue}</p>)}</div>}
      </section>
      <Budget session={session} month={month} metadata={metadata} hidden={!budgetOpen} />
    </main>
    <Popover.Root handle={cellEditorHandle} open={!!cellEditorRow}
      triggerId={cellEditor ? cellEditorTriggerId(cellEditor.field, cellEditor.id) : null}
      onOpenChange={(open, {trigger, reason}) => {
        if (!open) {
          if (cellEditor) closeCellEditor(cellEditor.id, reason === 'escape-key');
          return;
        }

        const cell = trigger?.closest<HTMLElement>('[data-editor-cell]');
        const field = cell?.dataset.editorCell;
        const id = cell?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
        const row = visible.find(row => row.id === Number(id));
        if (row && isCellEditorField(field)) showEditor(field, [row]);
      }}>
      {cellEditor && cellEditorRow && <Popover.Portal>
        <Popover.Positioner anchor={cellEditor.anchor} align="start" sideOffset={4} className={paletteStyles.cellEditorPositioner}>
          <Popover.Popup className={paletteStyles.cellEditorPopup} aria-label={editTitle(cellEditor.field, false)} initialFocus={false} finalFocus={false}>
            <TransactionEditor key={cellEditor.field + cellEditor.id} field={cellEditor.field} rows={[cellEditorRow]}
              metadata={metadata} payees={payees} close={() => closeCellEditor(cellEditor.id, true)}
              save={(label, patch) => {
                closeCellEditor(cellEditor.id, true);
                changeRows(label, [cellEditorRow], patch);
              }} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>}
    </Popover.Root>
    {modal && overlay && <Modal title={modal.title} close={close} restore={restoreFocus} back={modal.back}>
      <div key={overlay.kind === 'facet' ? 'facet:' + overlay.facet : overlay.kind === 'edit' ? 'edit:' + overlay.field : overlay.kind}>{modal.body}</div>
    </Modal>}
  </>;
}

function SearchEditor({value, update, done, wider, range, count, pending}: {
  value: string; update: (value: string) => void; done: () => void; wider: () => void; range: Range; count: number; pending: boolean;
}) {
  const input = useInitialFocus<HTMLInputElement>();
  return <form className={ui.editor} onSubmit={event => { event.preventDefault(); done(); }}>
    <label>Payee, bank descriptor, or notes<input ref={input} value={value} onChange={event => update(event.target.value)} /></label>
    <p role="status">{range.start} – {range.end} · {pending ? 'Loading…' : countLabel(count)}</p>
    <div className={ui.controls}><button type="submit">Show results</button><button type="button" onClick={wider}>Search a wider date range</button></div>
  </form>;
}

function Connect({connect, live}: {connect: (token?: string) => void; live: boolean}) {
  const [token, setToken] = useState('');
  return <form className={ui.editor} onSubmit={event => { event.preventDefault(); if (token.trim()) connect(token.trim()); }}>
    <label>Lunch Money API token<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>
    <p>This browser saves your token for this site and sends it directly to Lunch Money. Disconnect clears the saved token.</p>
    <div className={ui.controls}><button type="submit" disabled={!token.trim()}>Connect</button>
      {live && <button type="button" onClick={() => connect()}>Disconnect</button>}</div>
  </form>;
}
