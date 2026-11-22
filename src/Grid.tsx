import {Cell, Checkbox, Column, Row as TableRow, Table, TableBody, TableHeader, type Selection as AriaSelection, type SortDescriptor} from 'react-aria-components';
import type {RefObject} from 'react';
import {money, type Metadata, type Row} from './api';
import {PayeeEditor} from './Editors';
import {categoryName, columns, reviewLabel, tagNames} from './sorting';

export type Field = 'category' | 'payee' | 'date' | 'note' | 'tags';

export function Grid({rows, selected, select, active, activeScope, grid, enter, leave, open, details, editing, payees, applyPayee, cancelPayee, leavePayee, metadata, loading, sort, onSort}: {
  rows: Row[]; selected: Set<number>; select: (selection: AriaSelection) => void;
  active?: number; activeScope: boolean; grid: RefObject<HTMLDivElement | null>;
  enter: (id?: number) => void; leave: () => void; open: (field: Field, row: Row) => void;
  details: (id: number) => void; editing?: number; payees: string[]; applyPayee: (id: number, payee: string) => void;
  cancelPayee: (id: number) => void; leavePayee: (id: number) => void; metadata?: Metadata; loading: boolean;
  sort?: SortDescriptor; onSort: (sort: SortDescriptor) => void;
}) {
  const editable = (field: Field, row: Row, text: string, ariaLabel?: string) =>
    <button className="cell-action" tabIndex={-1} aria-label={ariaLabel ?? text}
      onClick={event => { event.stopPropagation(); open(field, row); }}>{text}</button>;

  return <div className="grid-scroll" ref={grid} onFocusCapture={event => {
    const row = event.target.closest<HTMLElement>('[data-row-id]');
    enter(row ? Number(row.dataset.rowId) : undefined);
  }} onBlurCapture={event => {
    const container = event.currentTarget;
    if (!container.contains(event.relatedTarget)) {
      queueMicrotask(() => { if (!container.contains(document.activeElement)) leave(); });
    }
  }}>
    <Table aria-label="Transactions" aria-busy={loading} className="grid" selectionMode="multiple" selectionBehavior="toggle"
      keyboardNavigationBehavior={editing === undefined ? 'arrow' : 'tab'}
      selectedKeys={selected} onSelectionChange={select} sortDescriptor={sort} onSortChange={onSort} onRowAction={id => details(Number(id))}>
      <TableHeader>
        <Column><Checkbox slot="selection" aria-label="Select all visible transactions"><span aria-hidden>✓</span></Checkbox></Column>
        {columns.map(({id, label}) => (
          <Column key={id} id={id} textValue={label} isRowHeader={id === 'payee'} allowsSorting
            className={id === 'amount' ? 'amount' : id === 'review' ? 'review-cell' : undefined}>
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
      <TableBody items={rows} dependencies={[active, activeScope, editing, payees, metadata, open, applyPayee, cancelPayee, leavePayee]} renderEmptyState={() => <p>{loading ? 'Loading transactions…' : 'No transactions match this view.'}</p>}>
        {row => <TableRow id={row.id} data-row-id={row.id} data-active={activeScope && active === row.id || undefined}>
          <Cell><Checkbox slot="selection" aria-label={'Select ' + row.payee}><span aria-hidden>✓</span></Checkbox></Cell>
          <Cell>{editable('date', row, row.date, 'Change date for ' + row.payee)}</Cell>
          <Cell>{editable('category', row, categoryName(row, metadata), 'Change category for ' + row.payee)}</Cell>
          <Cell>{editing === row.id ? <PayeeEditor value={row.payee} payees={payees} apply={payee => applyPayee(row.id, payee)}
              cancel={() => cancelPayee(row.id)} onLeave={() => leavePayee(row.id)} />
            : <div className="payee">{editable('payee', row, row.payee, 'Edit payee for ' + row.payee)}</div>}</Cell>
          <Cell className="amount">{money(Number(row.amount), row.currency)}</Cell>
          <Cell className="note-cell">{editable('note', row, row.notes || '—',
            row.notes ? 'Note for ' + row.payee + ': ' + row.notes : 'Add note for ' + row.payee)}</Cell>
          <Cell>{editable('tags', row, tagNames(row, metadata).join(', ') || 'Add tags', 'Set tags for ' + row.payee)}</Cell>
          <Cell className="review-cell"><span className="review-indicator" role="img" aria-label={reviewLabel(row)} title={reviewLabel(row)}
            data-reviewed={row.status === 'reviewed' && !row.is_pending || undefined}>✓</span></Cell>
        </TableRow>}
      </TableBody>
    </Table>
  </div>;
}
