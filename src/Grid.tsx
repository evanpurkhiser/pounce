import {Repeat2, Split} from 'lucide-react';
import {Popover} from '@base-ui/react/popover';
import {rowSortingFeature, tableFeatures, useTable, type ColumnDef, type Row as TableRow} from '@tanstack/react-table';
import {memo, useLayoutEffect, useRef, type RefObject} from 'react';
import {money, type Metadata, type Row} from './api';
import {NoteEditor, PayeeEditor} from './Editors';
import {categoryName, columns, reviewLabel, tagNames, type SortColumn, type SortDescriptor} from './sorting';
import {cellEditorTriggerId, editActions, reviewIcons, type Field} from './transactionActions';
import type {GridInteraction} from './useTransactionGrid';

type InlineEditor = {
  field: 'payee' | 'note';
  id: number;
  payees: string[];
  apply: (value: string) => void;
  cancel: () => void;
  leave: (value?: string) => void;
};

type GridActions = Pick<GridInteraction, 'toggleRow' | 'toggleAll'> & {
  open: (field: Field, row: Row) => void;
  details: (id: number) => void;
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

const features = tableFeatures({rowSortingFeature, columnMeta: {} as {sortColumn: SortColumn}});
const accessorKeys = {
  date: 'date', category: 'category_id', payee: 'payee', amount: 'to_base', note: 'notes', tags: 'tag_ids', review: 'status',
} as const;
const columnDefs: ColumnDef<typeof features, Row>[] = [
  {id: 'selection', enableSorting: false},
  ...columns.map(({id, label}) => ({id, header: label, accessorKey: accessorKeys[id], meta: {sortColumn: id}})),
];

function cellClass(id: string) {
  if (id === 'amount') return 'amount';
  if (id === 'review') return 'review-cell';
}

export function Grid({interaction, open, details, onSort, ...table}: GridProps) {
  const {bindings, selected, toggleRow, toggleAll} = interaction;
  const actions = useRef({open, details, onSort, toggleRow, toggleAll});

  // Keep event handlers current without invalidating table or row memoization.
  useLayoutEffect(() => {
    actions.current = {open, details, onSort, toggleRow, toggleAll};
  }, [open, details, onSort, toggleRow, toggleAll]);

  return <div className="grid-scroll" {...bindings}>
    <TransactionTable {...table} selected={selected} actions={actions} />
  </div>;
}

const TransactionTable = memo(function TransactionTable({
  rows, selected, actions, inlineEditor, cellEditorHandle, metadata, loading, sort,
}: Omit<GridProps, 'interaction' | keyof GridActions> & {
  selected: GridInteraction['selected'];
  actions: RefObject<GridActions>;
}) {
  const sorting = sort ? [{id: sort.column, desc: sort.direction === 'descending'}] : [];
  const table = useTable({
    data: rows,
    columns: columnDefs,
    features,
    getRowId: row => String(row.id),
    // The workspace computes the order shared by search, range selection, and the palette.
    manualSorting: true,
    enableSortingRemoval: false,
    enableMultiSort: false,
    sortDescFirst: false,
    state: {sorting},
    onSortingChange(updater) {
      const [next] = typeof updater === 'function' ? updater(sorting) : updater;
      const column = next && table.getColumn(next.id)?.columnDef.meta?.sortColumn;
      if (column) actions.current.onSort({column, direction: next.desc ? 'descending' : 'ascending'});
    },
  });
  const header = table.getHeaderGroups()[0];
  const tableRows = table.getRowModel().rows;
  const allSelected = rows.length > 0 && selected.size === rows.length;

  return <table role="grid" aria-label="Transactions" aria-busy={loading} aria-multiselectable="true" tabIndex={0} className="grid">
    <thead role="rowgroup">
      <tr role="row">
        {header.headers.map(item => {
          const {column} = item;
          if (column.id === 'selection') {
            return <th role="columnheader" scope="col" key={item.id} tabIndex={-1}>
              <GridCheckbox label="Select all visible transactions" checked={allSelected}
                mixed={!allSelected && selected.size > 0} disabled={!rows.length} change={() => actions.current.toggleAll()} />
            </th>;
          }

          const direction = column.getIsSorted();
          return <th role="columnheader" scope="col" key={item.id} tabIndex={-1} className={cellClass(column.id)}
            aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
            onClick={column.getToggleSortingHandler()}>
            <button type="button" className="sort-button" data-grid-control tabIndex={-1}>
              {column.id === 'review' ? <>
                <span className="review-heading-label">Review</span>
                <reviewIcons.reviewed className="action-icon" aria-hidden />
              </> : <table.FlexRender header={item} />}
              {(column.id !== 'review' || direction) && (
                <span aria-hidden className="sort-indicator">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span>
              )}
            </button>
          </th>;
        })}
      </tr>
    </thead>
    <tbody role="rowgroup">
      {tableRows.map(row => <TransactionRow key={row.id} row={row} selected={selected.has(row.original.id)}
        hasSelection={selected.size > 0} actions={actions} metadata={metadata} cellEditorHandle={cellEditorHandle}
        inlineEditor={inlineEditor?.id === row.original.id ? inlineEditor : undefined} />)}
      {!tableRows.length && <tr role="row" data-empty><td role="gridcell" colSpan={header.headers.length}>
        {loading ? 'Loading transactions…' : 'No transactions match this view.'}
      </td></tr>}
    </tbody>
  </table>;
});

const TransactionRow = memo(function TransactionRow({row, selected, hasSelection, actions, metadata, cellEditorHandle, inlineEditor}: {
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

  function editable(field: Field, text: string, ariaLabel?: string, placeholder = false) {
    const {label, cellLabel} = editActions[field];
    const name = ariaLabel ?? (cellLabel ?? label) + ' for ' + payee;
    const content = <span title={placeholder ? undefined : text}>{text}</span>;

    if (field !== 'payee' && field !== 'note') {
      return <Popover.Trigger handle={cellEditorHandle} id={cellEditorTriggerId(field, id)} className="cell-action"
        data-grid-control data-placeholder={placeholder || undefined} tabIndex={-1} aria-label={name}>{content}</Popover.Trigger>;
    }

    return <button type="button" className="cell-action" data-grid-control data-placeholder={placeholder || undefined} tabIndex={-1} aria-label={name}
      onClick={() => actions.current.open(field, transaction)}>{content}</button>;
  }

  function cellContent(column: string) {
    switch (column) {
      case 'selection': return <GridCheckbox label={'Select ' + payee} checked={selected}
        change={extend => actions.current.toggleRow(id, extend)} />;
      case 'date': return editable('date', date);
      case 'category': return editable('category', categoryName(transaction, metadata));
      case 'payee': return inlineEditor?.field === 'payee'
        ? <PayeeEditor value={payee} payees={inlineEditor.payees} apply={inlineEditor.apply} cancel={inlineEditor.cancel} onLeave={inlineEditor.leave} />
        : editable('payee', payee);
      case 'amount': return <span className="amount-content">
        <span className="amount-indicators">
          {(transaction.is_split_parent || transaction.split_parent_id != null) &&
            <span role="img" aria-label="Split transaction" title="Split transaction"><Split className="action-icon" aria-hidden /></span>}
          {transaction.recurring_id != null &&
            <span role="img" aria-label="Recurring transaction" title="Recurring transaction"><Repeat2 className="action-icon" aria-hidden /></span>}
        </span>
        <span>{money(Number(transaction.amount), transaction.currency)}</span>
      </span>;
      case 'note': return inlineEditor?.field === 'note'
        ? <NoteEditor inline value={notes ?? ''} apply={inlineEditor.apply} cancel={inlineEditor.cancel} onLeave={inlineEditor.leave} />
        : editable('note', notes || 'No note', notes ? 'Note for ' + payee + ': ' + notes : 'Add note for ' + payee, !notes);
      case 'tags': return editable('tags', tagNames(transaction, metadata).join(', ') || 'No tags', undefined, !transaction.tag_ids.length);
      case 'review': {
        const reviewed = transaction.status === 'reviewed';
        const Icon = reviewIcons[reviewed ? 'reviewed' : 'unreviewed'];
        const label = reviewLabel(transaction);
        return <span role="img" aria-label={label} title={label} data-reviewed={reviewed || undefined}>
          <Icon className="action-icon" aria-hidden />
        </span>;
      }
    }
  }

  return <tr role="row" data-row-id={id} aria-selected={selected} tabIndex={-1} onClick={event => {
    if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)
      || event.target.closest('button,input,label,form')) return;
    event.currentTarget.focus();
    if (hasSelection) actions.current.toggleRow(id, event.shiftKey);
    else actions.current.details(id);
  }} onKeyDown={event => {
    if (event.key === 'Enter' && !event.defaultPrevented && event.target instanceof Element && event.currentTarget.contains(event.target) && !event.target.closest('button,input,form')) {
      event.preventDefault();
      actions.current.details(id);
    }
  }}>
    {row.getAllCells().map(cell => {
      const column = cell.column.id;
      const Tag = column === 'payee' ? 'th' : 'td';
      const editing = column === inlineEditor?.field;
      return <Tag key={cell.id} role={Tag === 'th' ? 'rowheader' : 'gridcell'} scope={Tag === 'th' ? 'row' : undefined} tabIndex={-1} className={cellClass(column)}
        data-editor-cell={column} data-editing={editing || undefined}>
        {cellContent(column)}
      </Tag>;
    })}
  </tr>;
});

function GridCheckbox({label, checked, mixed = false, disabled = false, change}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  change: (extend: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (input.current) input.current.indeterminate = mixed;
  }, [mixed]);

  return <label className="grid-checkbox">
    <input ref={input} type="checkbox" data-grid-control tabIndex={-1} aria-label={label}
      disabled={disabled} checked={checked}
      onChange={event => change(event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)} />
    <span aria-hidden>✓</span>
  </label>;
}
