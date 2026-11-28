import type {LetterKey} from '@tanstack/react-hotkeys';
import {
  CalendarDays,
  Circle,
  CircleCheck,
  Folder,
  NotebookPen,
  Tags,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import {isGroupPreview, type Row} from '../data/api';

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
  payee: {
    field: 'payee',
    key: 'P',
    icon: UserRound,
    label: 'Edit payee',
    bulkLabel: 'Set payee',
  },
  date: {
    field: 'date',
    key: 'D',
    icon: CalendarDays,
    label: 'Set transaction date',
    cellLabel: 'Change date',
  },
  note: {
    field: 'note',
    key: 'N',
    icon: NotebookPen,
    label: 'Set note',
    bulkLabel: 'Replace notes',
  },
  tags: {field: 'tags', key: 'T', icon: Tags, label: 'Set tags'},
};

export function editTitle(field: Field, multiple: boolean) {
  const {label, bulkLabel} = editActions[field];
  return multiple ? (bulkLabel ?? label) : label;
}

export type ReviewStatus = 'reviewed' | 'unreviewed';

export const reviewIcons = {reviewed: CircleCheck, unreviewed: Circle};
export const reviewShortcut = 'R';
export const reviewStatuses = ['reviewed', 'unreviewed'] as const;

export function reviewTargets(rows: Row[], status: ReviewStatus) {
  return rows.filter(
    row =>
      !isGroupPreview(row) &&
      row.status !== status &&
      !row.is_pending &&
      row.status !== 'delete_pending',
  );
}

export function reviewStatusFor(rows: Row[]): ReviewStatus {
  return reviewTargets(rows, 'reviewed').length ? 'reviewed' : 'unreviewed';
}

export const transactionCountLabel = (count: number) =>
  count + (count === 1 ? ' transaction' : ' transactions');

export type InlineEditorField = Extract<Field, 'payee' | 'note'>;
export type CellEditorField = Exclude<Field, InlineEditorField>;

export function cellEditorTriggerId(field: CellEditorField, id: number) {
  return `edit-${field}-${id}`;
}

export function isCellEditorField(value?: string): value is CellEditorField {
  return value === 'category' || value === 'date' || value === 'tags';
}
