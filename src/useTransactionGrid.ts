import {useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject} from 'react';
import type {Selection as AriaSelection} from 'react-aria-components';
import type {Row} from './api';
import {emptySelection, restrictSelection, selectedKeys, selectRange, toggleRow} from './selection';

export function useTransactionGrid(rows: Row[], suspended: boolean, fallback: RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState(emptySelection);
  const [active, setActive] = useState<number>();
  const [hasFocus, setHasFocus] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const previousOrder = useRef<number[]>([]);
  const order = useMemo(() => rows.map(row => row.id), [rows]);
  const visible = useMemo(() => new Set(order), [order]);
  const selected = useMemo(() => selectedKeys(restrictSelection(selection, visible)), [selection, visible]);
  const focusedRow = hasFocus ? rows.find(row => row.id === active) : undefined;
  const selectedRows = useMemo(() => rows.filter(row => selected.has(row.id)), [rows, selected]);

  function rowElement(id?: number) {
    return id === undefined ? null : ref.current?.querySelector<HTMLElement>('[data-row-id="' + id + '"]') ?? null;
  }

  function focusRow(id?: number) {
    const target = rowElement(id) ?? ref.current?.querySelector<HTMLElement>('[role=grid]') ?? fallback.current;
    target?.focus();
  }

  useLayoutEffect(() => {
    setSelection(previous => restrictSelection(previous, visible));
  }, [visible]);

  useLayoutEffect(() => {
    if (active !== undefined && !visible.has(active)) {
      const index = previousOrder.current.indexOf(active);
      const next = order[Math.min(Math.max(0, index), order.length - 1)];
      setActive(next);

      if (!suspended && (hasFocus || ref.current?.contains(document.activeElement))) {
        requestAnimationFrame(() => {
          if (document.activeElement === document.body || ref.current?.contains(document.activeElement)) {
            focusRow(next);
            setHasFocus(true);
          }
        });
      }
    }
    previousOrder.current = order;
  }, [visible, active, hasFocus, suspended, order]);

  function move(direction: -1 | 1, extend = false) {
    if (!order.length) return;

    const index = !hasFocus || active === undefined ? -1 : order.indexOf(active);
    const to = order[index < 0 ? direction > 0 ? 0 : order.length - 1 : Math.min(order.length - 1, Math.max(0, index + direction))];
    if (extend && active !== undefined && to !== active) setSelection(previous => selectRange(previous, order, active, to, true));
    focusRow(to);
  }

  function toggleFocused() {
    if (active !== undefined) setSelection(previous => toggleRow(previous, active));
  }

  function extendToFocused() {
    if (active !== undefined) setSelection(previous => selectRange(previous, order, active, active, false));
  }

  function changeSelection(keys: AriaSelection) {
    const next = keys === 'all' ? new Set(order) : new Set([...keys].map(Number));
    const changes = order.filter(id => next.has(id) !== selected.has(id));
    setSelection(previous => ({independent: next, range: new Set(), anchor: changes.length === 1 ? changes[0] : active ?? previous.anchor}));
  }

  function endRange() {
    setSelection(previous => previous.range.size
      ? {...previous, independent: selectedKeys(previous), range: new Set()}
      : previous);
  }

  function clearSelection() {
    setSelection(emptySelection());
  }

  function reset() {
    clearSelection();
    setActive(undefined);
  }

  function onFocusCapture(event: FocusEvent<HTMLDivElement>) {
    const row = event.target.closest<HTMLElement>('[data-row-id]');
    setHasFocus(true);
    setActive(row ? Number(row.dataset.rowId) : undefined);
  }

  function onBlurCapture(event: FocusEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    if (!container.contains(event.relatedTarget)) {
      queueMicrotask(() => { if (!container.contains(document.activeElement)) setHasFocus(false); });
    }
  }

  function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (!hasFocus || suspended || (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true]'))) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      move(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      setSelection({independent: new Set(order), range: new Set(), anchor: active});
    }
  }

  return {
    active, hasFocus, selected, focusedRow, selectedRows,
    rowElement, focusRow, move, toggleFocused, extendToFocused, endRange, clearSelection, reset, changeSelection,
    bindings: {ref, onFocusCapture, onBlurCapture, onKeyDownCapture},
  };
}

export type GridInteraction = Pick<ReturnType<typeof useTransactionGrid>, 'selected' | 'changeSelection' | 'bindings'>;
