import {accountKey, type Metadata, type Patch, type Row} from './api';
import {CategoryPicker, DateEditor, Details, NoteEditor, PayeeEditor, TagPicker} from './Editors';
import {categoryName} from './sorting';
import type {Field} from './transactionActions';

export type RowPatch = Patch | ((row: Row) => Patch);

function commonValue(values: string[]) {
  const [first] = values;
  return values.every(value => value === first) ? first ?? '' : '';
}

export function TransactionEditor({field, rows, metadata, payees, save, close}: {
  field: Field;
  rows: Row[];
  metadata?: Metadata;
  payees: string[];
  save: (label: string, patch: RowPatch) => void;
  close: () => void;
}) {
  if (!rows.length) {
    return <p className="editor">The target rows are unavailable for editing.</p>;
  }

  switch (field) {
    case 'category':
      return <CategoryPicker rows={rows} choices={metadata?.categories ?? []}
        apply={category_id => save('Changed category', {category_id})} />;
    case 'tags':
      return <TagPicker rows={rows} choices={metadata?.tags ?? []} apply={staged => save('Changed tags', row => {
        const tagIds = new Set(row.tag_ids);
        for (const [id, add] of staged) {
          if (add) tagIds.add(id);
          else tagIds.delete(id);
        }
        return {tag_ids: [...tagIds]};
      })} />;
    case 'date':
      return <DateEditor value={commonValue(rows.map(row => row.date))} apply={date => save('Changed date', {date})} />;
    case 'payee':
      return <PayeeEditor value={commonValue(rows.map(row => row.payee))} payees={payees}
        apply={payee => save('Changed payee', {payee})} cancel={close} />;
    case 'note': {
      if (rows.length !== 1) {
        const notes = rows.map(row => row.notes ?? '');
        return <NoteEditor value={commonValue(notes)} mixed={new Set(notes).size > 1}
          apply={value => save('Changed notes', {notes: value})} />;
      }

      const [row] = rows;
      const account = accountKey(row);
      return <Details row={row} note category={categoryName(row, metadata)}
        account={metadata?.accounts.find(item => item.id === account)?.label ?? account}
        apply={notes => save('Changed note', {notes})} />;
    }
  }
}
