import {ArrowDownUp, CalendarDays, Check, ChevronLeft, ChevronRight, Circle, Command, Filter as FilterIcon, List, Redo2, Search, Undo2, X} from 'lucide-react';
import {Toaster, toast} from 'sonner';
import {Popover} from '@base-ui/react/popover';
import {useLiveQuery} from '@tanstack/react-db';
import {QueryClientProvider, useQuery} from '@tanstack/react-query';
import {useHotkeys} from '@tanstack/react-hotkeys';
import {useMemo, useRef, useState} from 'react';
import type {SortDescriptor} from 'react-aria-components';
import {accountKey, canEdit, canReview, currentMonth, inRange, liveSource, monthLabel, monthRange, shiftMonth, type Choice, type Range, type Row} from './api';
import {Budget} from './Budget';
import {createSession, message, type Session} from './data';
import {Details, RangeEditor} from './Editors';
import {Grid} from './Grid';
import {CommandList, Modal, Picker, useInitialFocus, type CommandItem} from './Palette';
import {rank} from './search';
import {columns, defaultSort, sortTransactions} from './sorting';
import {TransactionEditor, type RowPatch} from './TransactionEditor';
import {canEditAny, cellEditorTriggerId, editActions, editTitle, isCellEditorField, reviewShortcut, reviewStatuses, reviewTargets, type CellEditorField, type Field, type ReviewStatus} from './transactionActions';
import {demoSource} from './transactions';
import {useEdits} from './useEdits';
import {useTransactionGrid} from './useTransactionGrid';
import {useTransactionPages} from './useTransactionPages';

const facets = ['review', 'category', 'tag', 'account', 'posting'] as const;
type Facet = typeof facets[number];
type Filters = Partial<Record<Facet, string[]>>;
type Overlay =
  | {kind: 'commands' | 'sort' | 'filters' | 'month' | 'search' | 'range' | 'shortcuts' | 'connect'}
  | {kind: 'facet'; facet: Facet}
  | {kind: 'edit'; field: Field; ids: number[]}
  | {kind: 'details'; id: number};

const facetLabels: Record<Facet, string> = {review: 'Review status', category: 'Category', tag: 'Tag', account: 'Account', posting: 'Posting state'};
const reviews = [{id: 'reviewed', label: 'Reviewed'}, {id: 'unreviewed', label: 'Unreviewed'}, {id: '', label: 'Any review status'}];
const posting = [{id: 'pending', label: 'Pending'}, {id: 'posted', label: 'Posted'}, {id: '', label: 'Any posting state'}];
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
  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortDescriptor>();
  const gridSort = sort ?? (search ? undefined : defaultSort);
  const [overlay, setOverlay] = useState<Overlay>();
  const [cellEditor, setCellEditor] = useState<{id: number; field: CellEditorField; anchor: HTMLElement}>();
  const [cellEditorHandle] = useState(() => Popover.createHandle());
  const [inlineEditor, setInlineEditor] = useState<{id: number; field: 'payee' | 'note'}>();
  const [letterKeys, setLetterKeys] = useState(true);
  const commandButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const originRow = useRef<number | undefined>(undefined);
  const edits = useEdits(session);
  const range = customRange ?? monthRange(month);
  const {data: metadata, isError: metadataFailed, error: metadataError, refetch: refetchMetadata} = useQuery({
    queryKey: ['metadata'], queryFn: ({signal}) => session.source.metadata(signal),
  });
  const load = useTransactionPages(session, range);
  const {data: allRows = []} = useLiveQuery(session.rows);
  const choices: Record<Facet, Choice[]> = {
    review: reviews, posting, category: metadata?.categories ?? [], tag: metadata?.tags ?? [], account: metadata?.accounts ?? [],
  };
  const lookUp = (facet: Facet, id: string) => choices[facet].find(choice => choice.id === id)?.label ?? id;
  const visible = useMemo(() => {
    const ranged = allRows.filter(row => inRange(row.date, range));
    const matches = ranged.filter(row => {
      const category = row.category_id ?? 0;
      if (filters.category?.length && !filters.category.some(id => +id === category || metadata?.categories.find(item => item.id === id)?.members?.includes(category))) return false;
      if (filters.tag?.length && !filters.tag.some(id => row.tag_ids.includes(+id))) return false;
      if (filters.account?.length && !filters.account.includes(accountKey(row))) return false;
      if (filters.review?.length && !filters.review.includes(row.status)) return false;
      return !filters.posting?.length || filters.posting.includes(row.is_pending ? 'pending' : 'posted');
    });
    const ordered = sortTransactions(matches, sort ?? defaultSort, metadata);
    if (!search) return ordered;
    const results = rank(ordered.map(row => ({row, label: row.payee, aliases: [row.original_name ?? '', row.notes ?? '']})), search).map(item => item.row);
    return sort ? sortTransactions(results, sort, metadata) : results;
  }, [allRows, filters, metadata, range.start, range.end, search, sort]);
  const cellEditorRow = cellEditor && visible.find(row => row.id === cellEditor.id);
  const suspended = !!overlay || !!cellEditorRow || !!inlineEditor;
  const grid = useTransactionGrid(visible, suspended, commandButton);
  const {focusedRow, selectedRows} = grid;
  const targets = selectedRows.length ? selectedRows : focusedRow ? [focusedRow] : [];
  // TODO: Index historical payees per budget and persist the index and sync cursor in IndexedDB.
  const payees = useMemo(() => [...new Set(allRows.map(row => row.payee))].sort(), [allRows]);
  const overlayTargets = overlay?.kind === 'edit' ? overlay.ids.flatMap(id => {
    const row = session.rows.get(id);
    return row ? [row] : [];
  }) : [];
  const details = overlay?.kind === 'details' ? session.rows.get(overlay.id) : undefined;

  function restoreFocus() {
    const previous = previousFocus.current;
    if (previous?.isConnected) return previous;
    return grid.rowElement(originRow.current) ?? grid.rowElement(grid.active) ?? commandButton.current;
  }

  function open(next: Overlay) {
    if (!overlay) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      originRow.current = focusedRow?.id;
    }
    setCellEditor(undefined);
    setInlineEditor(undefined);
    setOverlay(next);
  }

  function close() {
    setOverlay(undefined);
    requestAnimationFrame(() => restoreFocus()?.focus());
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
    setSort(next);
    grid.endRange();
  }

  function setFacet(facet: Facet, ids: string[]) {
    setFilters(previous => ({...previous, [facet]: ids.filter(Boolean)}));
  }

  function toggleFacet(facet: Facet, id: string) {
    const values = filters[facet] ?? [];
    setFacet(facet, values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
  }

  function changeRows(label: string, rows: Row[], patch: RowPatch, eligible: (row: Row) => boolean = canEdit) {
    const valid = rows.filter(eligible);
    if (overlay) close();
    edits.save(label, valid.map(row => ({id: row.id, patch: typeof patch === 'function' ? patch(row) : patch})), rows.length - valid.length);
  }

  function showEditor(field: Field, rows: Row[]) {
    if (!canEditAny(rows) || edits.busy) return;
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
    if (restoreRowFocus) requestAnimationFrame(() => grid.focusRow(id));
  }

  function review(status: ReviewStatus, rows: Row[]) {
    const candidates = rows.filter(row => row.status !== status);
    changeRows(status === 'reviewed' ? 'Marked reviewed' : 'Marked unreviewed', candidates, {status}, canReview);
  }

  const shortcutsEnabled = !suspended && letterKeys;
  const gridKeys = shortcutsEnabled && grid.hasFocus;
  const readyForEdit = !edits.busy && !load.isPending;
  const reviewStatusFor = (rows: Row[]): ReviewStatus => reviewTargets(rows, 'reviewed').length ? 'reviewed' : 'unreviewed';
  const directReviewStatus = reviewStatusFor(targets);
  useHotkeys([
    {hotkey: 'Mod+K', callback: () => open({kind: 'commands'}), options: {enabled: !suspended}},
    {hotkey: 'Mod+Z', callback: () => edits.replay('undo'), options: {enabled: readyForEdit && edits.canUndo && !suspended}},
    {hotkey: 'Mod+Shift+Z', callback: () => edits.replay('redo'), options: {enabled: readyForEdit && edits.canRedo && !suspended}},
    {hotkey: 'A', callback: () => open({kind: 'sort'}), options: {enabled: shortcutsEnabled}},
    {hotkey: 'Shift+/', callback: () => open({kind: 'shortcuts'}), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'N'], callback: () => go(shiftMonth(month, 1)), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'P'], callback: () => go(shiftMonth(month, -1)), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'M'], callback: () => open({kind: 'month'}), options: {enabled: shortcutsEnabled}},
    {hotkey: 'J', callback: () => grid.move(1), options: {enabled: shortcutsEnabled && visible.length > 0}},
    {hotkey: 'K', callback: () => grid.move(-1), options: {enabled: shortcutsEnabled && visible.length > 0}},
    {hotkey: 'Shift+J', callback: () => grid.move(1, true), options: {enabled: gridKeys}},
    {hotkey: 'Shift+K', callback: () => grid.move(-1, true), options: {enabled: gridKeys}},
    {hotkey: 'X', callback: grid.toggleFocused, options: {enabled: gridKeys}},
    {hotkey: 'Shift+X', callback: grid.extendToFocused, options: {enabled: gridKeys}},
    {hotkey: reviewShortcut, callback: () => review(directReviewStatus, targets),
      options: {enabled: gridKeys && readyForEdit && reviewTargets(targets, directReviewStatus).length > 0}},
    ...Object.values(editActions).map(({field, key}) => ({
      hotkey: key, callback: () => showEditor(field, targets), options: {enabled: gridKeys && readyForEdit && !!targets.length},
    })),
  ]);

  function tableCommand(id: string, label: string, invoke: () => void, shortcut?: string): CommandItem {
    return {id, label, invoke, shortcut, icon: tableIcons[id], group: 'Table'};
  }

  const globalCommands = [
    tableCommand('filter', 'Filter', () => open({kind: 'filters'})),
    tableCommand('clear', 'Clear filters', () => { setFilters({}); close(); }),
    tableCommand('sort', 'Sort by', () => open({kind: 'sort'}), 'A'),
    tableCommand('search', 'Search transactions', () => open({kind: 'search'})),
    tableCommand('previous', 'Previous month', () => go(shiftMonth(month, -1)), 'G P'),
    tableCommand('next', 'Next month', () => go(shiftMonth(month, 1)), 'G N'),
    tableCommand('month', 'Go to month…', () => open({kind: 'month'}), 'G M'),
    tableCommand('current', 'Go to current month', () => go(currentMonth())),
    ...(edits.canUndo ? [tableCommand('undo', 'Undo last edit', () => { close(); edits.replay('undo'); }, '⌘Z')] : []),
    ...(edits.canRedo ? [tableCommand('redo', 'Redo last edit', () => { close(); edits.replay('redo'); }, '⌘⇧Z')] : []),
  ];

  function commandTargets() {
    if (selectedRows.length) return selectedRows;
    return overlay ? visible.filter(row => row.id === originRow.current) : targets;
  }

  const actionRows = commandTargets();
  const commandItems: CommandItem[] = readyForEdit && canEditAny(actionRows)
    ? Object.values(editActions).map(({field, key, icon}) => ({
      id: field, label: editTitle(field, actionRows.length > 1), icon,
      detail: actionRows.length > 1 ? countLabel(actionRows.filter(canEdit).length) : undefined,
      group: 'Transactions', shortcut: key, invoke: () => showEditor(field, actionRows),
    })) : [];
  if (readyForEdit) for (const status of reviewStatuses) {
    const count = reviewTargets(actionRows, status).length;
    if (count) commandItems.push({id: status, group: 'Transactions', label: 'Mark ' + (actionRows.length > 1 ? count + ' ' : '') + status,
      icon: status === 'reviewed' ? Check : Circle,
      shortcut: status === reviewStatusFor(actionRows) ? reviewShortcut : undefined,
      invoke: () => review(status, actionRows)});
  }
  if (actionRows.length === 1) {
    const [row] = actionRows;
    commandItems.push(
      {id: 'details', label: 'Open transaction', icon: List, group: 'Transactions', invoke: () => open({kind: 'details', id: row.id})},
      {id: 'similar', label: 'Find similar transactions', icon: Search, group: 'Transactions', invoke: () => { setSearch(row.payee); open({kind: 'search'}); }},
    );
  }

  const filterCommands: CommandItem[] = facets.flatMap(facet => {
    if (facet === 'review') return reviews.map(item => ({
      id: 'review:' + item.id, label: item.label, group: 'Review status',
      invoke: () => { setFacet(facet, [item.id]); close(); },
    }));
    return [{id: facet, label: facetLabels[facet], group: 'Filter', invoke: () => open({kind: 'facet', facet})}];
  });
  function nested(query: string) {
    const [first, ...rest] = query.trim().split(/\s+/);
    if (!rest.length || !rank([{label: 'Filter'}], first).length) return [];
    const all = facets.flatMap(facet => choices[facet].map(choice => ({
      ...choice, facet, aliases: [facetLabels[facet], ...(choice.aliases ?? [])],
    })));
    return rank(all, rest.join(' ')).slice(0, 12).map(choice => ({
      id: choice.facet + ':' + choice.id,
      label: 'Filter › ' + facetLabels[choice.facet] + ' › ' + choice.label,
      group: 'Matches',
      invoke: () => { setFacet(choice.facet, [choice.id]); close(); },
    }));
  }

  function finishInline(value?: string) {
    if (!inlineEditor) return;
    const {id, field} = inlineEditor;
    setInlineEditor(undefined);
    const row = session.rows.get(id);
    if (value !== undefined && row) {
      if (field === 'payee') changeRows('Changed payee', [row], {payee: value});
      else changeRows('Changed note', [row], {notes: value});
    }
    requestAnimationFrame(() => grid.focusRow(id));
  }

  const modal = overlay && renderOverlay(overlay);

  function renderOverlay(current: Overlay) {
    switch (current.kind) {
      case 'commands':
        return {title: 'Commands', body: <CommandList items={[...commandItems, ...globalCommands]} nested={nested} />};
      case 'sort': {
        const sortItems = columns.flatMap(({id, label, directions}) => (['ascending', 'descending'] as const).map((direction, index) => {
          const current = gridSort?.column === id && gridSort.direction === direction;
          return {
            ...tableCommand(id + ':' + direction, label + ' · ' + directions[index], () => {
              changeSort({column: id, direction});
              close();
            }),
            group: 'Sort by',
            shortcut: current ? 'Current' : undefined,
          };
        }));
        if (search) sortItems.unshift({...tableCommand('relevance', 'Search relevance', () => { changeSort(); close(); }),
          group: 'Sort by', shortcut: gridSort ? undefined : 'Current'});
        return {title: 'Sort by', back: () => open({kind: 'commands'}), body: <CommandList items={sortItems} />};
      }
      case 'filters':
        return {title: 'Filter', back: () => open({kind: 'commands'}), body: <CommandList items={[...filterCommands, globalCommands[1]]} />};
      case 'facet': {
        const {facet} = current;
        const multi = facet === 'category' || facet === 'tag' || facet === 'account';
        const checked = filters[facet] ?? [];
        return {title: 'Filter by ' + facetLabels[facet].toLowerCase(), back: () => open({kind: 'filters'}),
          body: <Picker title={'Search ' + facetLabels[facet].toLowerCase()} items={choices[facet].map(choice => ({...choice, mark: checked.includes(choice.id) ? 'checked' : undefined}))}
            choose={id => { setFacet(facet, [id]); close(); }}
            modifierToggle={multi ? id => toggleFacet(facet, id) : undefined}
            footer={multi && <><small>⌘Enter / Ctrl+Enter toggles values</small><button onClick={close}>Done</button></>} />};
      }
      case 'month':
        return {title: 'Go to month', body: <Picker title="Search months" items={Array.from({length: 180}, (_, index) => {
          const id = shiftMonth(currentMonth(), 12 - index);
          return {id, label: monthLabel(id), aliases: [id]};
        })} choose={go} />};
      case 'search':
        return {title: 'Search transactions', body: <SearchEditor value={search} count={visible.length} range={range} pending={load.isPending}
          update={setSearch} done={close} wider={() => open({kind: 'range'})} />};
      case 'range':
        return {title: 'Search a wider date range', back: () => open({kind: 'search'}), body: <RangeEditor range={range} apply={next => {
          setCustomRange(next); grid.reset(); open({kind: 'search'});
        }} />};
      case 'connect':
        return {title: 'Connect Lunch Money', body: <Connect connect={connect} live={live} />};
      case 'shortcuts':
        return {title: 'Keyboard shortcuts', body: <div className="editor"><dl>
          <dt>Move focus</dt><dd>↑ / ↓ or J / K</dd><dt>Select row or range</dt><dd>X, Shift+X, Shift+J/K, Shift+↑/↓</dd>
          <dt>Select visible results</dt><dd>⌘A / Ctrl+A</dd><dt>Edit fields</dt><dd>C category, P payee, D date, N note, T tags</dd>
          <dt>Review</dt><dd>R</dd><dt>Sort by</dt><dd>A</dd><dt>Months</dt><dd>G N next, G P previous, G M go to month</dd>
          <dt>Commands</dt><dd>⌘K / Ctrl+K</dd><dt>Undo / redo</dt><dd>⌘Z / ⌘⇧Z or Ctrl equivalents</dd>
        </dl><label><input type="checkbox" checked={letterKeys} onChange={event => setLetterKeys(event.target.checked)} /> Single-letter shortcuts</label></div>};
      case 'details':
        return details && {title: details.payee, body: <Details row={details} note={false} category={lookUp('category', String(details.category_id ?? 0))}
          account={lookUp('account', accountKey(details))} apply={canEdit(details) ? notes => changeRows('Changed note', [details], {notes}) : undefined} />};
      case 'edit': {
        const {field} = current;
        const rows = overlayTargets.filter(canEdit);
        return {
          title: rows.length ? editTitle(field, overlayTargets.length > 1) + ' · ' + countLabel(rows.length) : 'Transaction unavailable',
          body: <TransactionEditor field={field} rows={rows} skipped={overlayTargets.length - rows.length}
            metadata={metadata} payees={payees} save={(label, patch) => changeRows(label, overlayTargets, patch)} close={close} />,
        };
      }
    }
  }

  return <>
    <header className="top"><strong>Lunchline</strong><span>{live ? 'Lunch Money' : 'Sample data'}</span>
      <button onClick={() => open({kind: 'connect'})}>{live ? 'Connection' : 'Connect Lunch Money'}</button>
      <button onClick={() => open({kind: 'shortcuts'})}>Shortcuts <kbd>?</kbd></button>
      <button ref={commandButton} onClick={() => open({kind: 'commands'})}><Command className="action-icon" aria-hidden />Commands <kbd>⌘K</kbd></button>
    </header>
    <main className="layout">
      <section className="workspace" aria-labelledby="title">
        <h1 id="title">Transactions</h1>
        <div className="controls transaction-toolbar">
          <button onClick={() => go(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="action-icon" aria-hidden /></button>
          <button onClick={() => open({kind: 'month'})}>{monthLabel(month)}</button>
          <button onClick={() => go(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight className="action-icon" aria-hidden /></button>
          <button onClick={() => open({kind: 'filters'})}><FilterIcon className="action-icon" aria-hidden />Filter</button>
          <button onClick={() => open({kind: 'search'})}><Search className="action-icon" aria-hidden />Search transactions</button>
          {selectedRows.length > 0 && <div className="selection-toolbar">
            <span role="status">{countLabel(selectedRows.length)} selected</span>
            <button onClick={() => open({kind: 'commands'})}>Selection actions</button>
            <button onClick={grid.clearSelection}>Clear selection</button>
          </div>}
        </div>
        <div className="controls chips" aria-label="Active filters">
          {facets.flatMap(facet => (filters[facet] ?? []).map(id => <button key={facet + id}
            onClick={() => toggleFacet(facet, id)} aria-label={'Remove filter ' + lookUp(facet, id)}>{lookUp(facet, id)} ×</button>))}
          {search && <button onClick={() => setSearch('')} aria-label="Clear search">Search: {search} ×</button>}
          {customRange && <button onClick={() => go(month)} aria-label="Return to month">{range.start} – {range.end} ×</button>}
        </div>
        {metadataFailed && <p role="alert">{message(metadataError)} <button onClick={() => void refetchMetadata()}>Retry metadata</button></p>}
        {load.isError && <p role="alert">{message(load.error)} <button onClick={() => void load.retry()}>Retry transactions</button></p>}
        <Grid rows={visible} sort={gridSort} onSort={changeSort} interaction={grid}
          open={(field, row) => showEditor(field, [row])} details={id => open({kind: 'details', id})}
          cellEditorHandle={cellEditorHandle}
          inlineEditor={inlineEditor && {
            ...inlineEditor,
            payees,
            apply: finishInline,
            cancel: () => finishInline(),
            leave: () => setInlineEditor(current => current === inlineEditor ? undefined : current),
          }} metadata={metadata} loading={load.isPending} />
        <footer className="controls status">
          <span role="status">{edits.busy ? 'Saving…' : load.isPending ? 'Loading transactions…' : countLabel(visible.length)}</span>
          {edits.canUndo && <button disabled={edits.busy} onClick={() => edits.replay('undo')}>Undo</button>}
          {edits.canRedo && <button disabled={edits.busy} onClick={() => edits.replay('redo')}>Redo</button>}
        </footer>
        {edits.issues.length > 0 && <div className="warning" role="alert"><button onClick={edits.clearIssues}>Dismiss</button>
          {edits.issues.map(issue => <p key={issue}>{issue}</p>)}</div>}
      </section>
      <Budget session={session} month={month} metadata={metadata} />
    </main>
    <Popover.Root handle={cellEditorHandle} open={!!cellEditorRow}
      triggerId={cellEditor && cellEditorTriggerId(cellEditor.field, cellEditor.id)}
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
        <Popover.Positioner anchor={cellEditor.anchor} align="start" sideOffset={4} className="cell-editor-positioner">
          <Popover.Popup className="cell-editor-popup" aria-label={editTitle(cellEditor.field, false)} initialFocus={false} finalFocus={false}>
            <TransactionEditor key={cellEditor.field + cellEditor.id} field={cellEditor.field} rows={[cellEditorRow]} skipped={0}
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
  return <form className="editor" onSubmit={event => { event.preventDefault(); done(); }}>
    <label>Payee, bank descriptor, or notes<input ref={input} value={value} onChange={event => update(event.target.value)} /></label>
    <p role="status">{range.start} – {range.end} · {pending ? 'Loading…' : countLabel(count)}</p>
    <div className="controls"><button type="submit">Show results</button><button type="button" onClick={wider}>Search a wider date range</button></div>
  </form>;
}

function Connect({connect, live}: {connect: (token?: string) => void; live: boolean}) {
  const [token, setToken] = useState('');
  return <form className="editor" onSubmit={event => { event.preventDefault(); if (token.trim()) connect(token.trim()); }}>
    <label>Lunch Money API token<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>
    <p>This browser saves your token for this site and sends it directly to Lunch Money. Disconnect clears the saved token.</p>
    <div className="controls"><button type="submit" disabled={!token.trim()}>Connect</button>
      {live && <button type="button" onClick={() => connect()}>Disconnect</button>}</div>
  </form>;
}
