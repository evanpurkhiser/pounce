import {useLiveQuery} from '@tanstack/react-db';
import {QueryClientProvider, useQuery} from '@tanstack/react-query';
import {useHotkeys} from '@tanstack/react-hotkeys';
import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {SortDescriptor} from 'react-aria-components';
import {accountKey, canEdit, canReview, currentMonth, inRange, liveSource, monthLabel, monthRange, shiftMonth, type Choice, type Patch, type Range, type Row} from './api';
import {Budget} from './Budget';
import {createSession, message, type Session} from './data';
import {CategoryPicker, DateEditor, Details, NoteEditor, PayeeEditor, RangeEditor, TagPicker} from './Editors';
import {Grid, type Field} from './Grid';
import {CommandList, Modal, Picker, useInitialFocus, type CommandItem} from './Palette';
import {rank} from './search';
import {emptySelection, restrictSelection, selectedKeys, selectRange, toggleRow} from './selection';
import {columns, defaultSort, sortTransactions} from './sorting';
import {demoSource} from './transactions';
import {useEdits} from './useEdits';

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
const fieldKeys = {category: 'C', payee: 'P', date: 'D', note: 'N', tags: 'T'} as const;
const countLabel = (count: number) => count + (count === 1 ? ' transaction' : ' transactions');

function editTitle(field: Field, multiple: boolean) {
  switch (field) {
    case 'category': return 'Change category';
    case 'payee': return multiple ? 'Set payee' : 'Edit payee';
    case 'date': return 'Set transaction date';
    case 'note': return multiple ? 'Replace notes' : 'Set note';
    case 'tags': return 'Set tags';
  }
}

function commonValue<T>(items: T[], blank: T): T {
  return items.length && items.every(item => item === items[0]) ? items[0] : blank;
}

export function App() {
  const [connection, setConnection] = useState(() => ({session: createSession(demoSource()), live: false, id: 0}));
  function connect(token?: string) {
    setConnection(previous => ({session: createSession(token ? liveSource(token) : demoSource()), live: !!token, id: previous.id + 1}));
  }

  return <QueryClientProvider client={connection.session.query}>
    <Workspace key={connection.id} {...connection} connect={connect} />
  </QueryClientProvider>;
}

function Workspace({session, live, connect}: {session: Session; live: boolean; connect: (token?: string) => void}) {
  const [month, setMonth] = useState(currentMonth);
  const [customRange, setCustomRange] = useState<Range>();
  const [filters, setFilters] = useState<Filters>({review: ['unreviewed']});
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortDescriptor>();
  const gridSort = sort ?? (search ? undefined : defaultSort);
  const [selection, setSelection] = useState(emptySelection);
  const [active, setActive] = useState<number>();
  const [gridActive, setGridActive] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>();
  const [inlinePayee, setInlinePayee] = useState<number>();
  const [letterKeys, setLetterKeys] = useState(true);
  const grid = useRef<HTMLDivElement>(null);
  const commandButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const originRow = useRef<number | undefined>(undefined);
  const oldOrder = useRef<number[]>([]);
  const edits = useEdits(session);
  const range = customRange ?? monthRange(month);
  const {data: metadata, isError: metadataFailed, error: metadataError, refetch: refetchMetadata} = useQuery({
    queryKey: ['metadata'], queryFn: ({signal}) => session.source.metadata(signal),
  });
  const load = useQuery({queryKey: ['transactions', range.start, range.end], queryFn: ({signal}) => session.load(range, signal)});
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
  const order = useMemo(() => visible.map(row => row.id), [visible]);
  const visibleIds = useMemo(() => new Set(order), [order]);
  const payees = useMemo(() => [...new Set(allRows.map(row => row.payee))].sort(), [allRows]);
  const selected = selectedKeys(restrictSelection(selection, visibleIds));
  const targets = selected.size ? visible.filter(row => selected.has(row.id)) : gridActive ? visible.filter(row => row.id === active) : [];
  const focused = gridActive ? visible.find(row => row.id === active) : undefined;
  const overlayTargets = overlay?.kind === 'edit' ? overlay.ids.flatMap(id => {
    const row = session.rows.get(id);
    return row ? [row] : [];
  }) : [];
  const details = overlay?.kind === 'details' ? session.rows.get(overlay.id) : undefined;

  function rowElement(id?: number) {
    return id === undefined ? null : grid.current?.querySelector<HTMLElement>('[data-row-id="' + id + '"]') ?? null;
  }

  function focusRow(id?: number) {
    const target = rowElement(id) ?? grid.current?.querySelector<HTMLElement>('[role=grid]') ?? commandButton.current;
    target?.focus();
  }

  function nextRow(id: number) {
    const index = oldOrder.current.indexOf(id);
    return order[Math.min(Math.max(0, index), order.length - 1)];
  }

  useLayoutEffect(() => {
    setSelection(previous => restrictSelection(previous, visibleIds));
    if (active !== undefined && !visibleIds.has(active)) {
      const next = nextRow(active);
      setActive(next);
      if (!overlay && inlinePayee === undefined && (gridActive || grid.current?.contains(document.activeElement))) {
        requestAnimationFrame(() => {
          if (document.activeElement === document.body || grid.current?.contains(document.activeElement)) {
            focusRow(next);
            setGridActive(true);
          }
        });
      }
    }
    oldOrder.current = order;
  }, [visibleIds, active, gridActive, overlay, inlinePayee, order]);

  function restoreFocus() {
    const previous = previousFocus.current;
    if (previous?.isConnected) return previous;
    return rowElement(originRow.current) ?? rowElement(active) ?? commandButton.current;
  }

  function open(next: Overlay) {
    if (!overlay) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      originRow.current = focused?.id;
    }
    setOverlay(next);
  }

  function close() {
    setOverlay(undefined);
    requestAnimationFrame(() => restoreFocus()?.focus());
  }

  function go(next: string) {
    setMonth(next);
    setCustomRange(undefined);
    setSelection(emptySelection());
    setActive(undefined);
    if (overlay) close();
  }

  function changeSort(next?: SortDescriptor) {
    setSort(next);
    setSelection(previous => previous.range.size
      ? {...previous, independent: selectedKeys(previous), range: new Set()}
      : previous);
  }

  function setFacet(facet: Facet, ids: string[]) {
    setFilters(previous => ({...previous, [facet]: ids.filter(Boolean)}));
  }

  function toggleFacet(facet: Facet, id: string) {
    const values = filters[facet] ?? [];
    setFacet(facet, values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
  }

  function changeRows(label: string, rows: Row[], patch: Patch | ((row: Row) => Patch), eligible: (row: Row) => boolean = canEdit) {
    const valid = rows.filter(eligible);
    if (overlay) close();
    edits.save(label, valid.map(row => ({id: row.id, patch: typeof patch === 'function' ? patch(row) : patch})), rows.length - valid.length);
  }

  function showEditor(field: Field, rows: Row[]) {
    if (!rows.some(canEdit) || edits.busy) return;
    if (field === 'payee' && rows.length === 1 && !overlay) {
      setInlinePayee(rows[0].id);
    } else {
      open({kind: 'edit', field, ids: rows.map(row => row.id)});
    }
  }

  function move(direction: number, extend = false) {
    if (!order.length) return;
    const index = active === undefined ? -1 : order.indexOf(active);
    const to = order[index < 0 ? direction > 0 ? 0 : order.length - 1 : Math.min(order.length - 1, Math.max(0, index + direction))];
    if (extend && active !== undefined && to !== active) setSelection(previous => selectRange(previous, order, active, to, true));
    focusRow(to);
  }

  function review(status: 'reviewed' | 'unreviewed', rows: Row[]) {
    const candidates = rows.filter(row => row.status !== status);
    changeRows(status === 'reviewed' ? 'Marked reviewed' : 'Marked unreviewed', candidates, {status}, canReview);
  }

  const shortcutsEnabled = !overlay && inlinePayee === undefined && letterKeys;
  const gridKeys = shortcutsEnabled && gridActive;
  const readyForEdit = !edits.busy && !load.isPending;
  useHotkeys([
    {hotkey: 'Mod+K', callback: () => open({kind: 'commands'}), options: {enabled: !overlay && inlinePayee === undefined}},
    {hotkey: 'Mod+Z', callback: () => edits.replay('undo'), options: {enabled: readyForEdit && edits.canUndo && !overlay && inlinePayee === undefined}},
    {hotkey: 'Mod+Shift+Z', callback: () => edits.replay('redo'), options: {enabled: readyForEdit && edits.canRedo && !overlay && inlinePayee === undefined}},
    {hotkey: 'A', callback: () => open({kind: 'sort'}), options: {enabled: shortcutsEnabled}},
    {hotkey: 'Shift+/', callback: () => open({kind: 'shortcuts'}), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'N'], callback: () => go(shiftMonth(month, 1)), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'P'], callback: () => go(shiftMonth(month, -1)), options: {enabled: shortcutsEnabled}},
    {hotkey: ['G', 'M'], callback: () => open({kind: 'month'}), options: {enabled: shortcutsEnabled}},
    {hotkey: 'J', callback: () => move(1), options: {enabled: gridKeys}},
    {hotkey: 'K', callback: () => move(-1), options: {enabled: gridKeys}},
    {hotkey: 'Shift+J', callback: () => move(1, true), options: {enabled: gridKeys}},
    {hotkey: 'Shift+K', callback: () => move(-1, true), options: {enabled: gridKeys}},
    {hotkey: 'X', callback: () => { if (active !== undefined) setSelection(previous => toggleRow(previous, active)); }, options: {enabled: gridKeys}},
    {hotkey: 'Shift+X', callback: () => { if (active !== undefined) setSelection(previous => selectRange(previous, order, active, active, false)); }, options: {enabled: gridKeys}},
    {hotkey: 'R', callback: () => { if (focused) review(focused.status === 'reviewed' ? 'unreviewed' : 'reviewed', [focused]); }, options: {enabled: gridKeys && readyForEdit && !!focused && canReview(focused)}},
    ...Object.entries(fieldKeys).map(([field, key]) => ({
      hotkey: key, callback: () => showEditor(field as Field, targets), options: {enabled: gridKeys && readyForEdit && !!targets.length},
    })),
  ]);

  function gridKey(event: React.KeyboardEvent) {
    if (!gridActive || overlay || inlinePayee !== undefined || (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true]'))) return;
    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (direction) {
      event.preventDefault();
      event.stopPropagation();
      move(direction, event.shiftKey);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      setSelection({independent: new Set(order), range: new Set(), anchor: active});
    }
  }

  function tableCommand(id: string, label: string, invoke: () => void, shortcut?: string): CommandItem {
    return {id, label, invoke, shortcut, group: 'Table'};
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
    if (selected.size) return visible.filter(row => selected.has(row.id));
    return overlay ? visible.filter(row => row.id === originRow.current) : targets;
  }

  const actionRows = commandTargets();
  const commandItems: CommandItem[] = readyForEdit && actionRows.some(canEdit)
    ? (Object.keys(fieldKeys) as Field[]).map(field => ({
      id: field, label: editTitle(field, actionRows.length > 1) + (actionRows.length > 1 ? ' · ' + countLabel(actionRows.length) : ''),
      group: 'Transactions', shortcut: fieldKeys[field], invoke: () => showEditor(field, actionRows),
    })) : [];
  if (readyForEdit) for (const status of ['reviewed', 'unreviewed'] as const) {
    const count = actionRows.filter(row => canReview(row) && row.status !== status).length;
    if (count) commandItems.push({id: status, group: 'Transactions', label: 'Mark ' + (actionRows.length > 1 ? count + ' ' : '') + status,
      invoke: () => review(status, actionRows)});
  }
  if (actionRows.length === 1) {
    const [row] = actionRows;
    commandItems.push(
      {id: 'details', label: 'Open transaction', group: 'Transactions', invoke: () => open({kind: 'details', id: row.id})},
      {id: 'similar', label: 'Find similar transactions', group: 'Transactions', invoke: () => { setSearch(row.payee); open({kind: 'search'}); }},
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

  function finishPayee(id: number, payee?: string) {
    setInlinePayee(undefined);
    const row = session.rows.get(id);
    if (payee && row) changeRows('Changed payee', [row], {payee});
    requestAnimationFrame(() => focusRow(id));
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
          setCustomRange(next); setSelection(emptySelection()); setActive(undefined); open({kind: 'search'});
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
        if (!rows.length) return {title: 'Transaction unavailable', body: <p className="editor">The target rows are unavailable for editing.</p>};
        const save = (label: string, patch: Patch | ((row: Row) => Patch)) => changeRows(label, overlayTargets, patch);
        const body = field === 'category' ? <CategoryPicker rows={rows} choices={choices.category} apply={category_id => save('Changed category', {category_id})} />
          : field === 'tags' ? <TagPicker rows={rows} choices={choices.tag} apply={staged => save('Changed tags', row => {
            const tagIds = new Set(row.tag_ids);
            for (const [id, add] of staged) { if (add) tagIds.add(id); else tagIds.delete(id); }
            return {tag_ids: [...tagIds]};
          })} />
          : field === 'date' ? <DateEditor value={commonValue(rows.map(row => row.date), '')} apply={date => save('Changed date', {date})} />
          : field === 'payee' ? <PayeeEditor value={commonValue(rows.map(row => row.payee), '')} payees={payees} apply={payee => save('Changed payee', {payee})} cancel={close} />
          : rows.length === 1 ? <Details row={rows[0]} note category={lookUp('category', String(rows[0].category_id ?? 0))}
              account={lookUp('account', accountKey(rows[0]))} apply={notes => save('Changed note', {notes})} />
            : <NoteEditor value={commonValue(rows.map(row => row.notes ?? ''), '')} apply={notes => save('Changed notes', {notes})} />;
        return {title: editTitle(field, overlayTargets.length > 1) + ' · ' + countLabel(rows.length),
          body: <>{rows.length < overlayTargets.length && <p className="warning">{overlayTargets.length - rows.length} ineligible rows will be skipped.</p>}{body}</>};
      }
    }
  }

  return <>
    <header className="top"><strong>Lunchline</strong><span>{live ? 'Lunch Money' : 'Sample data'}</span>
      <button onClick={() => open({kind: 'connect'})}>{live ? 'Connection' : 'Connect Lunch Money'}</button>
      <button onClick={() => open({kind: 'shortcuts'})}>Shortcuts <kbd>?</kbd></button>
      <button ref={commandButton} onClick={() => open({kind: 'commands'})}>Commands <kbd>⌘K</kbd></button>
    </header>
    <main className="layout">
      <section className="workspace" aria-labelledby="title">
        <h1 id="title">Transactions</h1>
        <div className="controls">
          <button onClick={() => go(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <button onClick={() => open({kind: 'month'})}>{monthLabel(month)}</button>
          <button onClick={() => go(shiftMonth(month, 1))} aria-label="Next month">›</button>
          <button onClick={() => open({kind: 'filters'})}>Filter</button>
          <button onClick={() => open({kind: 'search'})}>Search transactions</button>
        </div>
        <div className="controls chips" aria-label="Active filters">
          {facets.flatMap(facet => (filters[facet] ?? []).map(id => <button key={facet + id}
            onClick={() => toggleFacet(facet, id)} aria-label={'Remove filter ' + lookUp(facet, id)}>{lookUp(facet, id)} ×</button>))}
          {search && <button onClick={() => setSearch('')} aria-label="Clear search">Search: {search} ×</button>}
          {customRange && <button onClick={() => go(month)} aria-label="Return to month">{range.start} – {range.end} ×</button>}
        </div>
        {selected.size > 0 && <div className="controls selection-toolbar">
          <span role="status">{countLabel(selected.size)} selected</span>
          <button onClick={() => open({kind: 'commands'})}>Selection actions</button>
          <button onClick={() => setSelection(emptySelection())}>Clear selection</button>
        </div>}
        {metadataFailed && <p role="alert">{message(metadataError)} <button onClick={() => void refetchMetadata()}>Retry metadata</button></p>}
        {load.isError && <p role="alert">{message(load.error)} <button onClick={() => void load.refetch()}>Retry transactions</button></p>}
        <div onKeyDownCapture={gridKey}>
          <Grid rows={visible} sort={gridSort} onSort={changeSort} selected={selected} select={keys => {
            const next = keys === 'all' ? new Set(order) : new Set([...keys].map(Number));
            const changes = order.filter(id => next.has(id) !== selected.has(id));
            setSelection(previous => ({independent: next, range: new Set(), anchor: changes.length === 1 ? changes[0] : active ?? previous.anchor}));
          }} active={active} activeScope={gridActive} grid={grid} enter={id => { setGridActive(true); setActive(id); }} leave={() => setGridActive(false)}
            open={(field, row) => showEditor(field, [row])} details={id => open({kind: 'details', id})} editing={inlinePayee}
            payees={payees} applyPayee={finishPayee} cancelPayee={finishPayee}
            leavePayee={id => setInlinePayee(current => current === id ? undefined : current)} metadata={metadata} loading={load.isPending} />
        </div>
        <footer className="controls status">
          <span role="status">{edits.busy ? 'Saving…' : edits.notice || (!load.isPending ? countLabel(visible.length) : '')}</span>
          {edits.canUndo && <button disabled={edits.busy} onClick={() => edits.replay('undo')}>Undo</button>}
          {edits.canRedo && <button disabled={edits.busy} onClick={() => edits.replay('redo')}>Redo</button>}
        </footer>
        {edits.issues.length > 0 && <div className="warning" role="alert"><button onClick={edits.clearIssues}>Dismiss</button>
          {edits.issues.map(issue => <p key={issue}>{issue}</p>)}</div>}
      </section>
      <Budget session={session} month={month} metadata={metadata} />
    </main>
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
    <p>The browser sends this token directly to Lunch Money. It lasts until you reload or disconnect.</p>
    <div className="controls"><button type="submit" disabled={!token.trim()}>Connect</button>
      {live && <button type="button" onClick={() => connect()}>Disconnect</button>}</div>
  </form>;
}
