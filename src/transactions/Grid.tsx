import {
  memo,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent,
} from 'react';

import {Popover} from '@base-ui/react/popover';
import {
  columnResizingFeature,
  columnSizingFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type Header,
  type Row as TableRow,
} from '@tanstack/react-table';
import {Check, Repeat2, Split} from 'lucide-react';

import {money, type Metadata, type Row} from '../data/api';
import {NoteEditor, PayeeEditor} from '../editors/Editors';
import {CheckboxIcon} from '../ui/CheckboxIcon';
import ui from '../ui/ui.module.css';

import styles from './Grid.module.css';
import {
  categoryName,
  columns,
  reviewLabel,
  transactionTags,
  type SortColumn,
  type SortDescriptor,
} from './sorting';
import {
  cellEditorTriggerId,
  editActions,
  isCellEditorField,
  reviewIcons,
  type Field,
  type InlineEditorField,
} from './transactionActions';
import {TransactionTag} from './TransactionTag';
import type {GridInteraction} from './useTransactionGrid';

type InlineEditor = {
  field: InlineEditorField;
  id: number;
  payees: string[];
  apply: (value: string) => void;
  cancel: () => void;
  leave: (value?: string) => void;
};

type GridActions = Pick<GridInteraction, 'toggleRow' | 'toggleAll'> & {
  open: (field: Field, row: Row) => void;
  onSort: (sort: SortDescriptor) => void;
};

type GridProps = Omit<GridActions, 'toggleRow' | 'toggleAll'> & {
  rows: Row[];
  interaction: GridInteraction;
  inlineEditor?: InlineEditor;
  cellEditorHandle: ReturnType<typeof Popover.createHandle>;
  metadata?: Metadata;
  loading: boolean;
  sort?: SortDescriptor;
};

const features = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
  columnMeta: {} as {sortColumn: SortColumn},
});
const resizableColumns = new Set<SortColumn>(['category', 'payee', 'note', 'tags']);
const accessorKeys = {
  date: 'date',
  category: 'category_id',
  payee: 'payee',
  amount: 'to_base',
  note: 'notes',
  tags: 'tag_ids',
  review: 'status',
} as const;
const columnDefs: Array<ColumnDef<typeof features, Row>> = [
  {id: 'selection', enableSorting: false, enableResizing: false},
  ...columns.map(({id, label, defaultDirection}) => ({
    id,
    header: label,
    accessorKey: accessorKeys[id],
    meta: {sortColumn: id},
    enableResizing: resizableColumns.has(id),
    sortDescFirst: defaultDirection === 'descending',
  })),
];

function cellClass(id: string) {
  if (id === 'amount') {
    return styles.amount;
  }
  if (id === 'review') {
    return styles.reviewCell;
  }
  if (isCellEditorField(id) || id === 'payee' || id === 'note') {
    return styles.editCell;
  }
}

export function Grid({interaction, open, onSort, ...table}: GridProps) {
  const {bindings, selected, toggleRow, toggleAll} = interaction;
  const actions = useRef({open, onSort, toggleRow, toggleAll});

  // Keep event handlers current without invalidating table or row memoization.
  useLayoutEffect(() => {
    actions.current = {open, onSort, toggleRow, toggleAll};
  }, [open, onSort, toggleRow, toggleAll]);

  return (
    <div {...bindings}>
      <TransactionTable {...table} selected={selected} actions={actions} />
    </div>
  );
}

const TransactionTable = memo(function TransactionTable({
  rows,
  selected,
  actions,
  inlineEditor,
  cellEditorHandle,
  metadata,
  loading,
  sort,
}: Omit<GridProps, 'interaction' | keyof GridActions> & {
  selected: GridInteraction['selected'];
  actions: RefObject<GridActions>;
}) {
  const sorting = sort ? [{id: sort.column, desc: sort.direction === 'descending'}] : [];
  const table = useTable(
    {
      data: rows,
      columns: columnDefs,
      features,
      getRowId: row => String(row.id),
      // The workspace computes the order shared by search, range selection, and the palette.
      manualSorting: true,
      enableSortingRemoval: false,
      enableMultiSort: false,
      columnResizeMode: 'onChange',
      defaultColumn: {minSize: 72},
      state: {sorting},
      onSortingChange(updater) {
        const [next] = typeof updater === 'function' ? updater(sorting) : updater;
        const column = next && table.getColumn(next.id)?.columnDef.meta?.sortColumn;
        if (column) {
          actions.current.onSort({
            column,
            direction: next.desc ? 'descending' : 'ascending',
          });
        }
      },
    },
    state => state.columnSizing,
  );
  const widths: CSSProperties & Record<`--${string}-width`, string> = {};
  const header = table.getHeaderGroups()[0];
  for (const {column} of header.headers) {
    if (table.state[column.id] !== undefined) {
      widths[`--${column.id}-width`] = `${column.getSize()}px`;
    }
  }

  const tableRows = table.getRowModel().rows;
  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <table
      role="grid"
      aria-label="Transactions"
      aria-busy={loading}
      aria-multiselectable="true"
      tabIndex={0}
      className={styles.grid}
      style={widths}
    >
      <thead role="rowgroup">
        <tr role="row">
          {header.headers.map(item => {
            const {column} = item;
            if (column.id === 'selection') {
              return (
                <th role="columnheader" scope="col" key={item.id} tabIndex={-1}>
                  <GridCheckbox
                    label="Select all visible transactions"
                    checked={allSelected}
                    mixed={!allSelected && selected.size > 0}
                    disabled={!rows.length}
                    change={() => actions.current.toggleAll()}
                  />
                </th>
              );
            }

            return (
              <TransactionColumnHeader
                key={item.id}
                header={item}
                label={<table.FlexRender header={item} />}
              />
            );
          })}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {tableRows.map(row => (
          <TransactionRow
            key={row.id}
            row={row}
            selected={selected.has(row.original.id)}
            hasSelection={selected.size > 0}
            actions={actions}
            metadata={metadata}
            cellEditorHandle={cellEditorHandle}
            inlineEditor={inlineEditor?.id === row.original.id ? inlineEditor : undefined}
          />
        ))}
        {!tableRows.length && (
          <tr role="row" data-empty>
            <td role="gridcell" colSpan={header.headers.length}>
              {loading ? 'Loading transactions…' : 'No transactions match this view.'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
});

function TransactionColumnHeader({
  header,
  label,
}: {
  header: Header<typeof features, Row, unknown>;
  label: ReactNode;
}) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const {column, table} = header;
  const direction = column.getIsSorted();
  const canResize = column.getCanResize();

  function setWidth(width: number) {
    table.setColumnSizing(previous => ({...previous, [column.id]: width}));
  }

  function fitWidth() {
    const cell = cellRef.current;
    const grid = cell?.closest('table');
    if (!cell || !grid) {
      return;
    }

    const property = `--${column.id}-width`;
    const previous = grid.style.getPropertyValue(property);
    // Let the shared track measure its header and every rendered cell.
    grid.style.setProperty(property, 'max-content');
    const width = cell.getBoundingClientRect().width;
    grid.style.setProperty(property, previous);
    setWidth(width);
  }

  function startResize(event: MouseEvent<HTMLSpanElement> | TouchEvent<HTMLSpanElement>) {
    const cell = cellRef.current;
    if (!cell) {
      return;
    }

    // Seed the drag from the resolved CSS track, which is fluid until resized.
    setWidth(cell.getBoundingClientRect().width);
    header.getResizeHandler()(event);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const cell = cellRef.current;
    if (
      !cell ||
      !event.shiftKey ||
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    ) {
      return;
    }

    event.preventDefault();
    setWidth(
      cell.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 16 : -16),
    );
  }

  return (
    <th
      ref={cellRef}
      role="columnheader"
      scope="col"
      tabIndex={-1}
      className={cellClass(column.id)}
      aria-sort={
        direction === 'asc'
          ? 'ascending'
          : direction === 'desc'
            ? 'descending'
            : undefined
      }
      onClick={column.getToggleSortingHandler()}
    >
      <button
        type="button"
        className={styles.sortButton}
        data-grid-control
        tabIndex={-1}
        aria-keyshortcuts={canResize ? 'Shift+ArrowLeft Shift+ArrowRight' : undefined}
        onKeyDown={canResize ? resizeWithKeyboard : undefined}
      >
        {column.id === 'review' ? (
          <>
            <span className={styles.reviewHeadingLabel}>Review</span>
            <Check className={ui.actionIcon} aria-hidden />
          </>
        ) : (
          label
        )}
        {(column.id !== 'review' || direction) && (
          <span aria-hidden className={styles.sortIndicator}>
            {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}
          </span>
        )}
      </button>
      {canResize && (
        <span
          className={styles.resizeHandle}
          aria-hidden
          title={`Resize ${column.columnDef.header}`}
          onMouseDown={event => {
            if (event.button === 0) {
              startResize(event);
            }
          }}
          onTouchStart={event => {
            if (event.touches.length === 1) {
              startResize(event);
            }
          }}
          onDoubleClick={fitWidth}
          onClick={event => event.stopPropagation()}
        />
      )}
    </th>
  );
}

const TransactionRow = memo(function TransactionRow({
  row,
  selected,
  hasSelection,
  actions,
  metadata,
  cellEditorHandle,
  inlineEditor,
}: {
  row: TableRow<typeof features, Row>;
  selected: boolean;
  hasSelection: boolean;
  actions: RefObject<GridActions>;
  metadata?: Metadata;
  cellEditorHandle: GridProps['cellEditorHandle'];
  inlineEditor?: InlineEditor;
}) {
  const transaction = row.original;
  const {id, payee, date, notes} = transaction;

  function editable(field: Field, value: ReactNode, ariaLabel?: string) {
    const {label, cellLabel} = editActions[field];
    const name = ariaLabel ?? `${cellLabel ?? label} for ${payee}`;
    const content =
      typeof value === 'string' ? <span title={value || undefined}>{value}</span> : value;

    if (isCellEditorField(field)) {
      return (
        <Popover.Trigger
          handle={cellEditorHandle}
          id={cellEditorTriggerId(field, id)}
          className={styles.cellAction}
          data-grid-control
          tabIndex={-1}
          aria-label={name}
        >
          {content}
        </Popover.Trigger>
      );
    }

    return (
      <button
        type="button"
        className={styles.cellAction}
        data-grid-control
        tabIndex={-1}
        aria-label={name}
        onClick={() => actions.current.open(field, transaction)}
      >
        {content}
      </button>
    );
  }

  function cellContent(column: string) {
    switch (column) {
      case 'selection':
        return (
          <GridCheckbox
            label={`Select ${payee}`}
            checked={selected}
            change={extend => actions.current.toggleRow(id, extend)}
          />
        );
      case 'date':
        return editable('date', date);
      case 'category':
        return editable('category', categoryName(transaction, metadata));
      case 'payee':
        return inlineEditor?.field === 'payee' ? (
          <PayeeEditor
            value={payee}
            payees={inlineEditor.payees}
            apply={inlineEditor.apply}
            cancel={inlineEditor.cancel}
            onLeave={inlineEditor.leave}
          />
        ) : (
          editable('payee', payee)
        );
      case 'amount': {
        const amount = Number(transaction.amount);
        // Lunch Money uses negative amounts for credits.
        const isCredit = amount < 0;

        return (
          <span className={styles.amountContent}>
            <span className={styles.amountIndicators}>
              {(transaction.is_split_parent ||
                typeof transaction.split_parent_id === 'number') && (
                <span role="img" aria-label="Split transaction" title="Split transaction">
                  <Split className={ui.actionIcon} aria-hidden />
                </span>
              )}
              {typeof transaction.recurring_id === 'number' && (
                <span
                  role="img"
                  aria-label="Recurring transaction"
                  title="Recurring transaction"
                >
                  <Repeat2 className={ui.actionIcon} aria-hidden />
                </span>
              )}
            </span>
            <span className={isCredit ? styles.creditAmount : undefined}>
              {isCredit ? '+' : ''}
              {money(Math.abs(amount), transaction.currency)}
            </span>
          </span>
        );
      }
      case 'note':
        return inlineEditor?.field === 'note' ? (
          <NoteEditor
            inline
            value={notes ?? ''}
            apply={inlineEditor.apply}
            cancel={inlineEditor.cancel}
            onLeave={inlineEditor.leave}
          />
        ) : (
          editable(
            'note',
            notes ?? '',
            notes ? `Note for ${payee}: ${notes}` : `Add note for ${payee}`,
          )
        );
      case 'tags':
        return editable(
          'tags',
          <span className={styles.tagList}>
            {transactionTags(transaction, metadata).map(tag => (
              <TransactionTag key={tag.id} {...tag} />
            ))}
          </span>,
        );
      case 'review': {
        const reviewed = transaction.status === 'reviewed';
        const Icon = reviewIcons[reviewed ? 'reviewed' : 'unreviewed'];
        const label = reviewLabel(transaction);
        return (
          <span
            role="img"
            aria-label={label}
            title={label}
            data-reviewed={reviewed || undefined}
          >
            <Icon className={ui.actionIcon} aria-hidden />
          </span>
        );
      }
    }
  }

  return (
    <tr
      role="row"
      data-row-id={id}
      aria-selected={selected}
      tabIndex={-1}
      onClick={event => {
        if (
          !(event.target instanceof Element) ||
          !event.currentTarget.contains(event.target) ||
          event.target.closest('button,input,label,form')
        ) {
          return;
        }
        event.currentTarget.focus();
        if (hasSelection) {
          actions.current.toggleRow(id, event.shiftKey);
        }
      }}
    >
      {row.getAllCells().map(cell => {
        const column = cell.column.id;
        const Tag = column === 'payee' ? 'th' : 'td';
        const editing = column === inlineEditor?.field;
        return (
          <Tag
            key={cell.id}
            role={Tag === 'th' ? 'rowheader' : 'gridcell'}
            scope={Tag === 'th' ? 'row' : undefined}
            tabIndex={-1}
            className={cellClass(column)}
            data-editor-cell={column}
            data-editing={editing || undefined}
          >
            {cellContent(column)}
          </Tag>
        );
      })}
    </tr>
  );
});

function GridCheckbox({
  label,
  checked,
  mixed = false,
  disabled = false,
  change,
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  change: (extend: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (input.current) {
      input.current.indeterminate = mixed;
    }
  }, [mixed]);

  return (
    <label className={`${ui.checkbox} ${styles.gridCheckbox}`}>
      <input
        ref={input}
        type="checkbox"
        data-grid-control
        tabIndex={-1}
        aria-label={label}
        disabled={disabled}
        checked={checked}
        onChange={event =>
          change(event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)
        }
      />
      <CheckboxIcon
        className={styles.checkboxMark}
        state={mixed ? 'mixed' : checked ? 'checked' : 'unchecked'}
      />
    </label>
  );
}
