import {Popover} from '@base-ui/react/popover';
import {memo, useLayoutEffect, useRef, type RefObject} from 'react';
import {Cell, Checkbox, Column, Row as TableRow, Table, TableBody, TableHeader, type SortDescriptor} from 'react-aria-components';
import {money, type Metadata, type Row} from './api';
import {NoteEditor, PayeeEditor} from './Editors';
import {categoryName, columns, reviewLabel, tagNames} from './sorting';

import {cellEditorTriggerId, editActions, type Field} from './transactionActions';
import type {GridInteraction} from './useTransactionGrid';

type InlineEditor = {
  field: 'payee' | 'note';
  id: number;
  payees: string[];
  apply: (payee: string) => void;
  cancel: () => void;
  leave: () => void;
};

type GridActions = {
  open: (field: Field, row: Row) => void;
  details: (id: number) => void;
  onSort: (sort: SortDescriptor) => void;
  changeSelection: GridInteraction['changeSelection'];
};

type GridProps = Omit<GridActions, 'changeSelection'> & {
  rows: Row[];
  interaction: GridInteraction;
  inlineEditor?: InlineEditor;
  cellEditorHandle: ReturnType<typeof Popover.createHandle>;
  metadata?: Metadata;
  loading: boolean;
  sort?: SortDescriptor;
};

export function Grid({interaction, open, details, onSort, ...table}: GridProps) {
  const {bindings, changeSelection, selected} = interaction;
  // Cached row renderers and the table share stable callbacks that read the latest workspace actions.
  const actions = useRef({open, details, onSort, changeSelection});
  useLayoutEffect(() => {
    actions.current = {open, details, onSort, changeSelection};
  }, [open, details, onSort, changeSelection]);

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
  const editable = (field: Field, row: Row, text: string, ariaLabel?: string) => {
    const {label, cellLabel} = editActions[field];
    const name = ariaLabel ?? (cellLabel ?? label) + ' for ' + row.payee;
    if (field !== 'payee' && field !== 'note') {
      return <Popover.Trigger handle={cellEditorHandle} id={cellEditorTriggerId(field, row.id)} className="cell-action"
        tabIndex={-1} aria-label={name}
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}>{text}</Popover.Trigger>;
    }

    return <button className="cell-action" tabIndex={-1} aria-label={name}
      onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); actions.current.open(field, row); }}>{text}</button>;
  };

  return <Table aria-label="Transactions" aria-busy={loading} className="grid" selectionMode="multiple" selectionBehavior="toggle"
      keyboardNavigationBehavior={inlineEditor ? 'tab' : 'arrow'}
      selectedKeys={selected} onSelectionChange={keys => actions.current.changeSelection(keys)} sortDescriptor={sort}
      onSortChange={descriptor => actions.current.onSort(descriptor)} onRowAction={id => actions.current.details(Number(id))}>
      <TableHeader>
        <Column><Checkbox slot="selection" aria-label="Select all visible transactions"><span aria-hidden>✓</span></Checkbox></Column>
        {columns.map(({id, label}) => (
          <Column key={id} id={id} textValue={label} isRowHeader={id === 'payee'} allowsSorting
            className={id === 'amount' ? 'amount' : id === 'date' || id === 'review' ? id + '-cell' : undefined}>
            {({sortDirection}) => <>
              {id === 'review' ? <>
                <span className="review-heading-label">{label}</span>
                <span className="review-indicator" aria-hidden>✓</span>
              </> : label}
              {(id !== 'review' || sortDirection) && (
                <span aria-hidden className="sort-indicator">{sortDirection === 'ascending' ? '↑' : sortDirection === 'descending' ? '↓' : '↕'}</span>
              )}
            </>}
          </Column>
        ))}
      </TableHeader>
      <TableBody items={rows} dependencies={[inlineEditor, cellEditorHandle, metadata, actions]} renderEmptyState={() => <p>{loading ? 'Loading transactions…' : 'No transactions match this view.'}</p>}>
        {row => <TableRow id={row.id} data-row-id={row.id}>
          <Cell><Checkbox slot="selection" aria-label={'Select ' + row.payee}><span aria-hidden>✓</span></Checkbox></Cell>
          <Cell className="date-cell" data-editor-cell="date">{editable('date', row, row.date)}</Cell>
          <Cell data-editor-cell="category">{editable('category', row, categoryName(row, metadata))}</Cell>
          <Cell data-editor-cell="payee">{inlineEditor?.id === row.id && inlineEditor.field === 'payee' ? <PayeeEditor value={row.payee} payees={inlineEditor.payees}
              apply={inlineEditor.apply} cancel={inlineEditor.cancel} onLeave={inlineEditor.leave} />
            : <div className="payee">{editable('payee', row, row.payee)}</div>}</Cell>
          <Cell className="amount">{money(Number(row.amount), row.currency)}</Cell>
          <Cell className="note-cell" data-editor-cell="note">
            {inlineEditor?.id === row.id && inlineEditor.field === 'note'
              ? <NoteEditor value={row.notes ?? ''} apply={inlineEditor.apply} cancel={inlineEditor.cancel} onLeave={inlineEditor.leave} />
              : editable('note', row, row.notes || '—', row.notes ? 'Note for ' + row.payee + ': ' + row.notes : 'Add note for ' + row.payee)}
          </Cell>
          <Cell data-editor-cell="tags">{editable('tags', row, tagNames(row, metadata).join(', ') || 'Add tags')}</Cell>
          <Cell className="review-cell"><span className="review-indicator" role="img" aria-label={reviewLabel(row)} title={reviewLabel(row)}
            data-reviewed={row.status === 'reviewed' && !row.is_pending || undefined}>✓</span></Cell>
        </TableRow>}
      </TableBody>
    </Table>;
});
