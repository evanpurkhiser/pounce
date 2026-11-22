import {CalendarDays, Folder, NotebookPen, Tags, UserRound, type LucideIcon} from 'lucide-react';
import type {LetterKey} from '@tanstack/react-hotkeys';
import {canEdit, canReview, type Row} from './api';

export type Field = 'category' | 'payee' | 'date' | 'note' | 'tags';

type EditAction = {
  field: Field;
  key: LetterKey;
  icon: LucideIcon;
  label: string;
  bulkLabel?: string;
  cellLabel?: string;
};

export const editActions: Record<Field, EditAction> = {
  category: {field: 'category', key: 'C', icon: Folder, label: 'Change category'},
  payee: {field: 'payee', key: 'P', icon: UserRound, label: 'Edit payee', bulkLabel: 'Set payee'},
  date: {field: 'date', key: 'D', icon: CalendarDays, label: 'Set transaction date', cellLabel: 'Change date'},
  note: {field: 'note', key: 'N', icon: NotebookPen, label: 'Set note', bulkLabel: 'Replace notes'},
  tags: {field: 'tags', key: 'T', icon: Tags, label: 'Set tags'},
};

export function editTitle(field: Field, multiple: boolean) {
  const {label, bulkLabel} = editActions[field];
  return multiple ? bulkLabel ?? label : label;
}

export function canEditAny(rows: Row[]) {
  return rows.some(canEdit);
}

export type ReviewStatus = 'reviewed' | 'unreviewed';

export const reviewShortcut = 'R';
export const reviewStatuses = ['reviewed', 'unreviewed'] as const;

export function reviewTargets(rows: Row[], status: ReviewStatus) {
  return rows.filter(row => row.status !== status && canReview(row));
}

export type CellEditorField = Exclude<Field, 'payee' | 'note'>;

export function cellEditorTriggerId(field: CellEditorField, id: number) {
  return 'edit-' + field + '-' + id;
}

export function isCellEditorField(value?: string): value is CellEditorField {
  return value === 'category' || value === 'date' || value === 'tags';
}
