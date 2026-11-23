import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import type {Row} from '../data/api';

import {
  emptySelection,
  restrictSelection,
  selectedKeys,
  selectRange,
  toggleRow,
} from './selection';
import type {Field} from './transactionActions';

export function useTransactionGrid(
  rows: Row[],
  suspended: boolean,
  fallback: RefObject<HTMLElement | null>,
) {
  const [selection, setSelection] = useState(emptySelection);
  const [active, setActive] = useState<number>();
  const [hasFocus, setHasFocus] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tabStop = useRef<HTMLElement | null>(null);
  const previousOrder = useRef<number[]>([]);
  const order = useMemo(() => rows.map(row => row.id), [rows]);
  const visible = useMemo(() => new Set(order), [order]);
  const selected = useMemo(
    () => selectedKeys(restrictSelection(selection, visible)),
    [selection, visible],
  );
  const focusedRow = hasFocus ? rows.find(row => row.id === active) : undefined;
  const selectedRows = useMemo(
    () => rows.filter(row => selected.has(row.id)),
    [rows, selected],
  );

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

  function rowId(element: HTMLElement | null) {
    const id = element?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
    return id === undefined ? undefined : Number(id);
  }

  function focusedTransaction() {
    const id = rowId(focusedElement());
    return rows.find(row => row.id === id);
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

  function focusRow(id?: number) {
    focusTarget(rowElement(id) ?? tableElement() ?? fallback.current);
  }

  useLayoutEffect(() => {
    setSelection(previous => restrictSelection(previous, visible));
  }, [visible]);

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

  function move(direction: -1 | 1, extend = false, distance = 1) {
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
    const to =
      order[
        index < 0
          ? direction > 0
            ? 0
            : order.length - 1
          : Math.min(order.length - 1, Math.max(0, index + direction * distance))
      ];
    if (extend && from !== undefined && to !== from) {
      setSelection(previous => selectRange(previous, order, from, to, true));
    }
    if (column === undefined) {
      focusRow(to);
    } else if (direction < 0 && index === 0 && distance === 1 && !extend) {
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
      setHasFocus(false);
      setActive(undefined);
    }

    return true;
  }

  function toggleTransaction(id: number, extend = false) {
    setSelection(previous =>
      extend ? selectRange(previous, order, id, id, false) : toggleRow(previous, id),
    );
  }

  function toggleFocused() {
    if (active !== undefined) {
      toggleTransaction(active);
    }
  }

  function extendToFocused() {
    if (active !== undefined) {
      setSelection(previous => selectRange(previous, order, active, active, false));
    }
  }

  function selectAll() {
    setSelection({independent: new Set(order), range: new Set(), anchor: active});
  }

  function toggleAll() {
    if (selected.size === order.length) {
      clearSelection();
    } else {
      selectAll();
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

  function reset() {
    clearSelection();
    setActive(undefined);
    const table = tableElement();
    if (table) {
      setTabStop(table);
    }
  }

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

    const cell = target.closest<HTMLTableCellElement>('th,td');
    const row = target.closest<HTMLTableRowElement>('tr');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAll();
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
        const height = Math.min(event.currentTarget.clientHeight, window.innerHeight);
        const distance = Math.max(1, Math.floor(height / Math.max(1, row.offsetHeight)));
        move(event.key === 'PageDown' ? 1 : -1, event.shiftKey, distance);
        break;
      }
      case 'Tab':
      case 'ArrowLeft':
      case 'ArrowRight': {
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
        break;
      }
      case 'Home':
      case 'End': {
        const first = event.key === 'Home';
        if (event.metaKey || event.ctrlKey || !row) {
          event.preventDefault();
          const edge = rowElement(first ? order[0] : order.at(-1));
          if (edge) {
            focusCell(edge, first ? 0 : edge.cells.length - 1);
          }
        } else {
          event.preventDefault();
          focusCell(row, first ? 0 : row.cells.length - 1);
        }
        break;
      }
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
    cellElement,
    focusRow,
    focusTarget,
    focusedTransaction,
    move,
    jumpToEdge,
    escape,
    toggleFocused,
    extendToFocused,
    endRange,
    clearSelection,
    reset,
    toggleRow: toggleTransaction,
    toggleAll,
    bindings: {ref, onFocusCapture, onBlurCapture, onKeyDownCapture},
  };
}

export type GridInteraction = Pick<
  ReturnType<typeof useTransactionGrid>,
  'selected' | 'toggleRow' | 'toggleAll' | 'bindings'
>;
