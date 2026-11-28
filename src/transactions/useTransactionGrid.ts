import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import {money, type Metadata, type Row} from '../data/api';

import {
  emptySelection,
  restrictSelection,
  selectedKeys,
  selectRange,
  toggleRow,
} from './selection';
import {categoryName, transactionTags} from './sorting';
import type {Field} from './transactionActions';

function rowId(element: HTMLElement | null) {
  const id = element?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
  return id === undefined ? undefined : Number(id);
}

function focusTarget(target?: HTMLElement | null) {
  if (!target || target === document.activeElement) {
    return;
  }
  target.focus({preventScroll: true});
  target.scrollIntoView({block: 'nearest', inline: 'nearest'});
}

function focusCell(row: HTMLTableRowElement | null, index: number) {
  const cell = row?.cells[index];
  focusTarget(
    cell?.querySelector<HTMLElement>('[data-grid-control]:not(:disabled)') ?? cell,
  );
}

function moveAlongRow(event: KeyboardEvent<HTMLDivElement>, target: HTMLElement) {
  const cell = target.closest<HTMLTableCellElement>('th,td');
  const row = target.closest<HTMLTableRowElement>('tr');
  const tabbing = event.key === 'Tab';
  if (
    !row ||
    (tabbing && !row.hasAttribute('data-row-id')) ||
    (!tabbing &&
      event.shiftKey &&
      target.matches('[aria-keyshortcuts~="Shift+ArrowLeft"]'))
  ) {
    return;
  }

  const forward = tabbing ? !event.shiftKey : event.key === 'ArrowRight';
  const index = cell
    ? cell.cellIndex + (forward ? 1 : -1)
    : forward
      ? 0
      : row.cells.length - 1;
  if (tabbing && !row.cells[index]) {
    return;
  }

  event.preventDefault();
  focusCell(row, index);
}

function moveToEdge(
  event: KeyboardEvent<HTMLDivElement>,
  row: HTMLTableRowElement | null,
  findEdge: (first: boolean) => HTMLTableRowElement | null,
) {
  const first = event.key === 'Home';
  if (event.metaKey || event.ctrlKey || !row) {
    event.preventDefault();
    const edge = findEdge(first);
    if (edge) {
      focusCell(edge, first ? 0 : edge.cells.length - 1);
    }
  } else {
    event.preventDefault();
    focusCell(row, first ? 0 : row.cells.length - 1);
  }
}

function useGridSelection(order: number[], visible: Set<number>) {
  const [selection, setSelection] = useState(emptySelection);
  const selected = useMemo(
    () => selectedKeys(restrictSelection(selection, visible)),
    [selection, visible],
  );
  useLayoutEffect(() => {
    setSelection(previous => restrictSelection(previous, visible));
  }, [visible]);

  function toggleTransaction(id: number, extend = false) {
    setSelection(previous =>
      extend ? selectRange(previous, order, id, id, false) : toggleRow(previous, id),
    );
  }

  function selectAll(active: number | undefined) {
    setSelection({independent: new Set(order), range: new Set(), anchor: active});
  }

  function toggleAll(active: number | undefined) {
    if (selected.size === order.length) {
      clearSelection();
    } else {
      selectAll(active);
    }
  }

  function endRange() {
    setSelection(previous =>
      previous.range.size
        ? {...previous, independent: selectedKeys(previous), range: new Set()}
        : previous,
    );
  }

  function clearSelection() {
    setSelection(emptySelection());
  }

  return {
    selected,
    toggleTransaction,
    selectAll,
    toggleAll,
    endRange,
    clearSelection,
    extend: (from: number, to: number, additive: boolean) =>
      setSelection(previous => selectRange(previous, order, from, to, additive)),
  };
}

function useGridFocus(
  order: number[],
  visible: Set<number>,
  suspended: boolean,
  fallback: RefObject<HTMLElement | null>,
) {
  const [active, setActive] = useState<number>();
  const [hasFocus, setHasFocus] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tabStop = useRef<HTMLElement | null>(null);
  const previousOrder = useRef<number[]>([]);
  function rowElement(id?: number) {
    return id === undefined
      ? null
      : (ref.current?.querySelector<HTMLTableRowElement>(`[data-row-id="${id}"]`) ??
          null);
  }

  function cellElement(id: number, field: Field) {
    return rowElement(id)?.querySelector<HTMLElement>(`[data-editor-cell="${field}"]`);
  }

  function focusedElement() {
    const element = document.activeElement;
    return element instanceof HTMLElement && ref.current?.contains(element)
      ? element
      : null;
  }

  function tableElement() {
    return ref.current?.querySelector<HTMLTableElement>('[role=grid]');
  }

  function setTabStop(target: HTMLElement) {
    if (tabStop.current === target) {
      return;
    }
    const previous = tabStop.current ?? tableElement();
    if (previous) {
      previous.tabIndex = -1;
    }
    target.tabIndex = 0;
    tabStop.current = target;
  }

  function focusRow(id?: number) {
    focusTarget(rowElement(id) ?? tableElement() ?? fallback.current);
  }

  useLayoutEffect(() => {
    const table = tableElement();
    if (
      table &&
      tabStop.current &&
      (!tabStop.current.isConnected || tabStop.current.matches(':disabled'))
    ) {
      setTabStop(table);
    }

    if (active !== undefined && !visible.has(active)) {
      const index = previousOrder.current.indexOf(active);
      const next = order[Math.min(Math.max(0, index), order.length - 1)];
      setActive(next);

      if (!suspended && (hasFocus || ref.current?.contains(document.activeElement))) {
        requestAnimationFrame(() => {
          if (
            document.activeElement === document.body ||
            ref.current?.contains(document.activeElement)
          ) {
            focusRow(next);
          }
        });
      }
    }
    previousOrder.current = order;
  }, [visible, active, hasFocus, suspended, order]);

  function onFocusCapture(event: FocusEvent<HTMLDivElement>) {
    const target = event.target;
    if (!event.currentTarget.contains(target)) {
      return;
    }

    setHasFocus(true);
    setActive(rowId(target));

    if (target === tableElement() && order.length) {
      focusRow(order[0]);
    } else if (!target.closest('form')) {
      setTabStop(target);
    }
  }

  function onBlurCapture(event: FocusEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    if (!container.contains(event.relatedTarget)) {
      queueMicrotask(() => {
        if (!container.contains(document.activeElement)) {
          setHasFocus(false);
        }
      });
    }
  }

  return {
    active,
    hasFocus,
    ref,
    rowElement,
    cellElement,
    tableElement,
    setTabStop,
    focusedElement,
    focusRow,
    resetActive: () => setActive(undefined),
    clearActive: () => {
      setHasFocus(false);
      setActive(undefined);
    },
    bindings: {ref, onFocusCapture, onBlurCapture},
  };
}

export function useTransactionGrid(
  rows: Row[],
  suspended: boolean,
  fallback: RefObject<HTMLElement | null>,
  metadata: Metadata | undefined,
) {
  const order = useMemo(() => rows.map(row => row.id), [rows]);
  const visible = useMemo(() => new Set(order), [order]);
  const selection = useGridSelection(order, visible);
  const focus = useGridFocus(order, visible, suspended, fallback);
  const {
    active,
    hasFocus,
    ref,
    rowElement,
    tableElement,
    setTabStop,
    focusedElement,
    focusRow,
  } = focus;
  const {selected, toggleTransaction, clearSelection} = selection;
  const focusedRow = hasFocus ? rows.find(row => row.id === active) : undefined;
  const selectedRows = useMemo(
    () => rows.filter(row => selected.has(row.id)),
    [rows, selected],
  );

  function focusedTransaction() {
    const id = rowId(focusedElement());
    return rows.find(row => row.id === id);
  }

  function keyboardTargets() {
    const row = focusedTransaction();
    if (row) {
      return selectedRows.length ? selectedRows : [row];
    }
    return hasFocus ? selectedRows : [];
  }

  function move(direction: -1 | 1, extend = false, pageFraction?: number) {
    if (!order.length) {
      return;
    }

    const focused = focusedElement();
    const cell = focused?.closest<HTMLTableCellElement>('th,td');
    const column = cell?.cellIndex;
    if (column !== undefined && cell?.closest('thead')) {
      if (direction > 0) {
        focusCell(rowElement(order[0]), column);
      }
      return;
    }

    const from = rowId(focused);
    const index = from === undefined ? -1 : order.indexOf(from);
    const pageRow = pageFraction && focused?.closest<HTMLTableRowElement>('tr');
    const distance =
      pageFraction && pageRow && ref.current
        ? Math.max(
            1,
            Math.floor(
              (Math.min(ref.current.clientHeight, window.innerHeight) * pageFraction) /
                Math.max(1, pageRow.offsetHeight),
            ),
          )
        : 1;
    const to =
      order[
        index < 0
          ? direction > 0
            ? 0
            : order.length - 1
          : Math.min(order.length - 1, Math.max(0, index + direction * distance))
      ];
    if (extend && from !== undefined && to !== from) {
      selection.extend(from, to, true);
    }
    if (column === undefined) {
      focusRow(to);
    } else if (direction < 0 && index === 0 && pageFraction === undefined && !extend) {
      focusCell(tableElement()?.tHead?.rows[0] ?? null, column);
    } else {
      focusCell(rowElement(to), column);
    }
  }

  function jumpToEdge(edge: 'first' | 'last') {
    const id = edge === 'first' ? order[0] : order.at(-1);
    if (id === undefined) {
      return;
    }

    const cell = focusedElement()?.closest<HTMLTableCellElement>('th,td');
    if (cell) {
      focusCell(rowElement(id), cell.cellIndex);
    } else {
      focusRow(id);
    }
  }

  function escape() {
    if (selected.size) {
      clearSelection();
      return true;
    }

    const focused = focusedElement();
    if (!focused) {
      return false;
    }

    const id = rowId(focused);
    if (id !== undefined && focused !== rowElement(id)) {
      focusRow(id);
    } else {
      focused.blur();
      focus.clearActive();
    }

    return true;
  }

  function reset() {
    clearSelection();
    focus.resetActive();
    const table = tableElement();
    if (table) {
      setTabStop(table);
    }
  }

  function onCopy(event: ClipboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      suspended ||
      event.defaultPrevented ||
      !(target instanceof HTMLElement) ||
      !event.currentTarget.contains(target) ||
      target.matches('textarea,input:not([type=checkbox])') ||
      target.isContentEditable ||
      window.getSelection()?.isCollapsed === false
    ) {
      return;
    }

    const targets = keyboardTargets();
    if (!targets.length) {
      return;
    }

    const details = targets.map(row => {
      const amount = money(Number(row.amount), row.currency);
      const tags = transactionTags(row, metadata).map(tag => `[${tag.label}]`);
      const lines = [`${row.date} ${amount} ${row.payee}`, categoryName(row, metadata)];
      if (row.notes?.trim()) {
        lines.push(row.notes);
      }
      if (tags.length) {
        lines.push(`tagged as ${tags.join(' ')}`);
      }
      lines.push(`txn:${row.id}`);
      return lines.join('\n');
    });

    event.clipboardData.setData('text/plain', details.join('\n\n'));
    event.preventDefault();
  }

  function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      !hasFocus ||
      suspended ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      !(target instanceof HTMLElement) ||
      !event.currentTarget.contains(target) ||
      target.closest('textarea,input:not([type=checkbox]),[contenteditable=true]')
    ) {
      return;
    }

    const row = target.closest<HTMLTableRowElement>('tr');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selection.selectAll(active);
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        move(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
        break;
      case 'PageDown':
      case 'PageUp': {
        if (active === undefined || !row) {
          return;
        }
        event.preventDefault();
        move(event.key === 'PageDown' ? 1 : -1, event.shiftKey, 1);
        break;
      }
      case 'Tab':
      case 'ArrowLeft':
      case 'ArrowRight':
        moveAlongRow(event, target);
        break;
      case 'Home':
      case 'End':
        moveToEdge(event, row, first => rowElement(first ? order[0] : order.at(-1)));
        break;
      case ' ':
        if (active === undefined || target.closest('button,input')) {
          return;
        }
        event.preventDefault();
        toggleTransaction(active, event.shiftKey);
        break;
    }
  }

  return {
    active,
    hasFocus,
    selected,
    focusedRow,
    selectedRows,
    rowElement,
    cellElement: focus.cellElement,
    focusRow,
    focusTarget,
    focusedTransaction,
    keyboardTargets,
    move,
    jumpToEdge,
    escape,
    toggleFocused: () => {
      if (active !== undefined) {
        toggleTransaction(active);
      }
    },
    extendToFocused: () => {
      if (active !== undefined) {
        selection.extend(active, active, false);
      }
    },
    endRange: selection.endRange,
    clearSelection,
    reset,
    toggleRow: toggleTransaction,
    toggleAll: () => selection.toggleAll(active),
    bindings: {...focus.bindings, onCopy, onKeyDownCapture},
  };
}

export type GridInteraction = Pick<
  ReturnType<typeof useTransactionGrid>,
  'selected' | 'toggleRow' | 'toggleAll' | 'bindings'
>;
