import {useMemo, useState, useSyncExternalStore} from 'react';

import {toast} from 'sonner';

import type {Row} from './api';
import {
  message,
  resolveUpdate,
  type Edit,
  type QueuedUpdate,
  type Session,
} from './session';

type Draft = {label: string; updates: QueuedUpdate[]};
type EditState = {
  active?: Draft | 'replay' | 'recover';
  queued: Draft[];
  undo: Edit[];
  redo: Array<Draft | Edit>;
  issues: string[];
};

const emptyState: EditState = {queued: [], undo: [], redo: [], issues: []};

function createEditQueue() {
  let state = emptyState;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(values: Partial<EditState>) {
      state = {...state, ...values};
      for (const notify of listeners) {
        notify();
      }
    },
  };
}

export function useEdits(session: Session, rows: Row[]) {
  const [{getState, subscribe, update}] = useState(createEditQueue);
  const {active, queued, undo, redo, issues} = useSyncExternalStore(subscribe, getState);

  const visibleRows = useMemo(() => {
    const drafts = typeof active === 'object' ? [active, ...queued] : queued;
    if (!drafts.length) {
      return rows;
    }
    const byId = new Map<number, QueuedUpdate[]>();
    for (const draft of drafts) {
      for (const item of draft.updates) {
        const updates = byId.get(item.id);
        if (updates) {
          updates.push(item);
        } else {
          byId.set(item.id, [item]);
        }
      }
    }
    return rows.map(
      row =>
        byId
          .get(row.id)
          ?.reduce(
            (current, item) => ({...current, ...resolveUpdate(item, current)}),
            row,
          ) ?? row,
    );
  }, [active, queued, rows]);

  async function recover(draft: Draft, errors: string[]) {
    const {queued, redo} = getState();
    const discarded = queued.length;
    update({
      active: 'recover',
      queued: [],
      redo: redo.filter(item => 'changes' in item),
      issues: [
        ...errors,
        ...(discarded
          ? [
              `${discarded} queued ${discarded === 1 ? 'edit was' : 'edits were'} discarded.`,
            ]
          : []),
      ],
    });
    try {
      await session.refreshRows(draft.updates.map(({id}) => id));
    } catch (error) {
      update({
        issues: [
          ...getState().issues,
          `Could not refresh transactions. ${message(error)}`,
        ],
      });
    }
  }

  async function drain() {
    const {active, queued} = getState();
    const draft = queued[0];
    if (active || !draft) {
      return;
    }

    update({active: draft, queued: queued.slice(1), issues: []});
    try {
      const result = await session.write(draft.label, () => draft.updates);
      const count = result.edit.changes.length;
      if (count) {
        update({undo: [...getState().undo, result.edit]});
        toast.success(draft.label, {
          description:
            count + (count === 1 ? ' transaction saved' : ' transactions saved'),
        });
      }
      if (result.issues.length) {
        await recover(draft, result.issues);
      } else if (!count) {
        toast.info('No changes to save.');
      }
    } catch (error) {
      await recover(draft, [message(error)]);
    } finally {
      update({active: undefined});
      void drain();
    }
  }

  function save(label: string, updates: QueuedUpdate[]) {
    const {active, queued} = getState();
    if (active === 'replay' || !updates.length) {
      return;
    }

    update({queued: [...queued, {label, updates}], redo: []});
    void drain();
  }

  async function replayConfirmed(original: Edit, direction: 'undo' | 'redo') {
    update({active: 'replay', issues: []});
    try {
      const result = await session.replay(original, direction);
      const completed = new Set(result.edit.changes.map(change => change.id));
      const remaining = original.changes.filter(change => !completed.has(change.id));
      const moved = original.changes.filter(change => completed.has(change.id));
      update({issues: result.issues});
      if (moved.length) {
        const destination = direction === 'undo' ? 'redo' : 'undo';
        update({
          [direction]: [
            ...getState()[direction].slice(0, -1),
            ...(remaining.length ? [{...original, changes: remaining}] : []),
          ],
          [destination]: [...getState()[destination], {...original, changes: moved}],
        });
        toast.success(direction === 'undo' ? 'Undo complete' : 'Redo complete', {
          description: original.label,
        });
      } else if (!result.issues.length) {
        toast.info('No changes to save.');
      }
    } catch (error) {
      update({issues: [message(error)]});
    } finally {
      update({active: undefined});
    }
  }

  function replay(direction: 'undo' | 'redo') {
    const {active, queued, undo, redo} = getState();
    const pending = queued.at(-1);
    if (direction === 'undo' && pending) {
      update({queued: queued.slice(0, -1), redo: [...redo, pending]});
      return;
    }

    const original = (direction === 'undo' ? undo : redo).at(-1);
    if (!original) {
      return;
    }
    if ('updates' in original) {
      update({redo: redo.slice(0, -1), queued: [...queued, original]});
      void drain();
    } else if (!active) {
      void replayConfirmed(original, direction);
    }
  }

  const nextRedo = redo.at(-1);
  return {
    busy: Boolean(active),
    canEdit: active !== 'replay',
    rows: visibleRows,
    issues,
    clearIssues: () => update({issues: []}),
    canUndo: queued.length > 0 || (!active && undo.length > 0),
    canRedo: Boolean(nextRedo && ('updates' in nextRedo || !active)),
    save,
    replay,
  };
}
