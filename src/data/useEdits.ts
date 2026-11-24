import {useMemo, useState, useSyncExternalStore} from 'react';

import {toast} from 'sonner';

import type {Row} from './api';
import {
  message,
  partitionReplay,
  replayUpdates,
  resolveUpdate,
  type DraftUpdate,
  type Edit,
  type QueuedUpdate,
  type ReplayDirection,
  type Session,
  type WriteResult,
} from './session';

type Entry = {id: symbol; edit: Edit};
type Save = {kind: 'save'; entry: Entry; updates: DraftUpdate[]};
type Replay = {kind: ReplayDirection; entry: Entry};
type Job = Save | Replay;
type History = {undo: Entry[]; redo: Array<Entry | Save>};
type EditState = History & {
  active?: Job | 'recover';
  queued: Job[];
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

function pendingJobs(active: EditState['active'], queued: Job[]) {
  return typeof active === 'object' ? [active, ...queued] : queued;
}

function jobUpdates(job: Job) {
  return job.kind === 'save' ? job.updates : replayUpdates(job.entry.edit, job.kind);
}

function moveHistory(
  history: History,
  job: Replay,
  moved = job.entry,
  remaining?: Entry,
): History {
  const {kind, entry} = job;
  const undo = history.undo.flatMap(item =>
    item.id !== entry.id ? [item] : remaining ? [remaining] : [],
  );
  const redo = history.redo.flatMap(item =>
    'kind' in item || item.id !== entry.id ? [item] : remaining ? [remaining] : [],
  );
  return kind === 'undo'
    ? {undo, redo: [...redo, moved]}
    : {undo: [...undo, moved], redo};
}

// Confirmed history changes only on a write receipt. Pending jobs make the same
// transitions visible to keyboard shortcuts while the server catches up.
function projectedHistory(state: EditState) {
  return pendingJobs(state.active, state.queued).reduce<History>(
    (history, job) =>
      job.kind === 'save'
        ? {...history, undo: [...history.undo, job.entry]}
        : moveHistory(history, job),
    state,
  );
}

function confirmedHistory(
  state: EditState,
  job: Job,
  result: WriteResult,
): Partial<EditState> {
  const {edit} = result;
  const {entry} = job;
  if (job.kind === 'save') {
    if (!edit.changes.length) {
      return {queued: state.queued.filter(item => item.entry.id !== entry.id)};
    }

    const confirmed = {...entry, edit};
    return {
      undo: [...state.undo, confirmed],
      redo: state.redo.filter(item => 'kind' in item),
      queued: state.queued.map(item =>
        item.entry.id === entry.id ? {...item, entry: confirmed} : item,
      ),
    };
  }

  const {moved, remaining} = partitionReplay(entry.edit, edit);
  if (!moved.length) {
    return {};
  }

  if (!remaining.length) {
    return moveHistory(state, job);
  }

  return moveHistory(
    state,
    job,
    {id: Symbol(), edit: {...entry.edit, changes: moved}},
    {...entry, edit: {...entry.edit, changes: remaining}},
  );
}

export function useEdits(session: Session, rows: Row[]) {
  const [{getState, subscribe, update}] = useState(createEditQueue);
  const state = useSyncExternalStore(subscribe, getState);
  const {active, queued, issues} = state;

  const visibleRows = useMemo(() => {
    const jobs = pendingJobs(active, queued);
    if (!jobs.length) {
      return rows;
    }

    const byId = new Map<number, QueuedUpdate[]>();
    for (const job of jobs) {
      for (const item of jobUpdates(job)) {
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

  async function recover(job: Job, errors: string[], confirmed: Partial<EditState> = {}) {
    const {queued, redo} = getState();
    const discarded = queued.length;
    update({
      ...confirmed,
      active: 'recover',
      queued: [],
      redo: (confirmed.redo ?? redo).filter(item => !('kind' in item)),
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
      await session.refreshRows(jobUpdates(job).map(({id}) => id));
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
    const job = queued[0];
    if (active || !job) {
      return;
    }

    update({active: job, queued: queued.slice(1), issues: []});
    try {
      const {edit} = job.entry;
      const result =
        job.kind === 'save'
          ? await session.write(edit.label, () => job.updates)
          : await session.replay(edit, job.kind);
      const history = confirmedHistory(getState(), job, result);
      const count = result.edit.changes.length;
      if (count && job.kind === 'save') {
        toast.success(edit.label, {
          description:
            count + (count === 1 ? ' transaction saved' : ' transactions saved'),
        });
      } else if (count) {
        toast.success(job.kind === 'undo' ? 'Undo complete' : 'Redo complete', {
          description: edit.label,
        });
      } else if (!result.issues.length) {
        toast.info('No changes to save.');
      }

      if (result.issues.length) {
        await recover(job, result.issues, history);
      } else {
        update({...history, active: undefined});
      }
    } catch (error) {
      await recover(job, [message(error)]);
    } finally {
      if (getState().active === 'recover') {
        update({active: undefined});
      }
      void drain();
    }
  }

  function save(label: string, updates: DraftUpdate[]) {
    if (!updates.length) {
      return;
    }

    const {queued} = getState();
    const changes = updates.map(({id, before, patch}) => ({id, before, after: patch}));
    const entry = {id: Symbol(), edit: {label, changes}};
    update({queued: [...queued, {kind: 'save', entry, updates}], redo: []});
    void drain();
  }

  function replay(direction: ReplayDirection) {
    const state = getState();
    const {queued, redo} = state;
    const pending = queued.at(-1);
    if (direction === 'undo' && pending?.kind === 'save') {
      update({queued: queued.slice(0, -1), redo: [...redo, pending]});
      return;
    }

    const entry = projectedHistory(state)[direction].at(-1);
    if (!entry) {
      return;
    }

    if ('kind' in entry) {
      update({redo: redo.filter(item => item !== entry), queued: [...queued, entry]});
    } else if (
      pending &&
      pending.kind !== 'save' &&
      pending.kind !== direction &&
      pending.entry.id === entry.id
    ) {
      update({queued: queued.slice(0, -1)});
    } else {
      update({queued: [...queued, {kind: direction, entry}]});
    }
    void drain();
  }

  const history = useMemo(() => projectedHistory(state), [state]);
  return {
    busy: Boolean(active),
    rows: visibleRows,
    issues,
    clearIssues: () => update({issues: []}),
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    save,
    replay,
  };
}
