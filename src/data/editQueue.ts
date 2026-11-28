import type {Row} from './api';
import {
  editUpdate,
  resolvePatch,
  type Edit,
  type EditKind,
  type WriteIssue,
} from './editChanges';

type Entry = {kind: 'edit'; id: symbol; edit: Edit};
type Save = {kind: 'save'; entry: Entry};
type Job = Save | {kind: 'undo' | 'redo'; entry: Entry};
type Redo = Entry | Save;
type History = {undo: Entry[]; redo: Redo[]};
type Phase = {kind: 'idle'} | {kind: 'writing'; job: Job} | {kind: 'recovering'};
export type EditResult = {
  applied?: Edit;
  remaining?: Edit;
  savedCount?: number;
  issues: WriteIssue[];
};
type Completion = {kind: EditKind; label: string; result: EditResult};
export type EditIssue =
  | WriteIssue
  | {kind: 'discarded'; count: number}
  | {kind: 'refreshFailed'; issues: WriteIssue[]};

type State = {
  phase: Phase;
  queued: Job[];
  history: History;
  issues: EditIssue[];
  completion?: Completion;
};

type Event =
  | {type: 'save'; entry: Entry}
  | {type: 'replay'; direction: 'undo' | 'redo'}
  | {type: 'started'; job: Job}
  | {type: 'settled'; job: Job; result: EditResult; splitId: symbol}
  | {type: 'recovered'; issues: WriteIssue[]}
  | {type: 'clearIssues'};

type Adapter = {
  persist(edit: Edit, kind: EditKind): Promise<EditResult>;
  recover(edit: Edit): Promise<WriteIssue[]>;
};

const idle: Phase = {kind: 'idle'};
const initialState: State = {
  phase: idle,
  queued: [],
  history: {undo: [], redo: []},
  issues: [],
};

function pendingJobs(phase: Phase, queued: Job[]) {
  return phase.kind === 'writing' ? [phase.job, ...queued] : queued;
}

function isDraft(item: Redo): item is Save {
  return item.kind === 'save';
}

function moveEntry(
  {undo, redo}: History,
  {kind, entry}: Job,
  moved = entry,
  remaining?: Entry,
): History {
  if (kind === 'undo') {
    return {
      undo: undo.flatMap(item =>
        item.id !== entry.id ? [item] : remaining ? [remaining] : [],
      ),
      redo: [...redo, moved],
    };
  }
  return {
    undo: [...undo, moved],
    redo: redo.flatMap(item =>
      isDraft(item) || item.id !== entry.id ? [item] : remaining ? [remaining] : [],
    ),
  };
}

// Reduce the same intents for the optimistic UI and for the history confirmed
// by receipts. Canceling a pending intent removes its projected effects.
export function projectedHistory({phase, queued, history}: State) {
  return pendingJobs(phase, queued).reduce(
    (current, job) =>
      job.kind === 'save'
        ? {undo: [...current.undo, job.entry], redo: current.redo.filter(isDraft)}
        : moveEntry(current, job),
    history,
  );
}

export function projectRows(phase: Phase, queued: Job[], rows: Row[]) {
  const jobs = pendingJobs(phase, queued);
  if (!jobs.length) {
    return rows;
  }

  const updates = Map.groupBy(
    jobs.flatMap(({kind, entry}) =>
      entry.edit.changes.map(change => editUpdate(change, kind)),
    ),
    ({id}) => id,
  );

  return rows.map(
    row =>
      updates.get(row.id)?.reduce(
        (current, update) => ({
          ...current,
          ...resolvePatch(update, current),
        }),
        row,
      ) ?? row,
  );
}

function queueReplay(state: State, direction: 'undo' | 'redo'): State {
  const {history, queued} = state;
  const tail = queued.at(-1);
  if (direction === 'undo' && tail?.kind === 'save') {
    return {
      ...state,
      history: {...history, redo: [...history.redo, tail]},
      queued: queued.slice(0, -1),
    };
  }

  const entry = projectedHistory(state)[direction].at(-1);
  if (!entry) {
    return state;
  }
  if (isDraft(entry)) {
    return {
      ...state,
      history: {...history, redo: history.redo.filter(item => item !== entry)},
      queued: [...queued, entry],
    };
  }
  if (
    tail &&
    tail.kind !== 'save' &&
    tail.kind !== direction &&
    tail.entry.id === entry.id
  ) {
    return {...state, queued: queued.slice(0, -1)};
  }
  return {...state, queued: [...queued, {kind: direction, entry}]};
}

function applyResult(
  {history, queued}: State,
  {job, result: {applied, remaining}, splitId}: Extract<Event, {type: 'settled'}>,
) {
  const {entry} = job;
  if (!applied) {
    return {
      history,
      queued:
        job.kind === 'save' ? queued.filter(item => item.entry.id !== entry.id) : queued,
    };
  }

  const confirmed = {...entry, edit: applied};
  if (job.kind === 'save') {
    return {
      history: {undo: [...history.undo, confirmed], redo: history.redo.filter(isDraft)},
      queued: queued.map(item =>
        item.entry.id === entry.id ? {...item, entry: confirmed} : item,
      ),
    };
  }

  const unfinished = remaining && {...entry, edit: remaining};
  return {
    history: moveEntry(
      history,
      job,
      unfinished ? {...confirmed, id: splitId} : confirmed,
      unfinished,
    ),
    queued: queued.map(item =>
      item.entry.id === entry.id ? {...item, entry: confirmed} : item,
    ),
  };
}

function transition(state: State, event: Event): State {
  switch (event.type) {
    case 'save':
      return {
        ...state,
        queued: [...state.queued, {kind: 'save', entry: event.entry}],
        history: {...state.history, redo: []},
      };
    case 'replay':
      return queueReplay(state, event.direction);
    case 'started':
      return {
        ...state,
        phase: {kind: 'writing', job: event.job},
        queued: state.queued.slice(1),
        issues: [],
      };
    case 'settled': {
      const {job, result} = event;
      const next = applyResult(state, event);
      const completion = {kind: job.kind, label: job.entry.edit.label, result};
      if (!result.issues.length) {
        return {...state, ...next, phase: idle, completion};
      }

      const discarded = state.queued.length;
      const issues: EditIssue[] = [...result.issues];
      if (discarded) {
        issues.push({kind: 'discarded', count: discarded});
      }
      return {
        ...state,
        phase: {kind: 'recovering'},
        queued: [],
        history: {
          ...next.history,
          redo: next.history.redo.filter(item => !isDraft(item)),
        },
        issues,
        completion,
      };
    }
    case 'recovered':
      return {
        ...state,
        phase: idle,
        issues: event.issues.length
          ? [...state.issues, {kind: 'refreshFailed', issues: event.issues}]
          : state.issues,
      };
    case 'clearIssues':
      return {...state, issues: []};
  }
}

export function createEditQueue(adapter: Adapter) {
  let state = initialState;
  const listeners = new Set<() => void>();

  function dispatch(event: Event) {
    const next = transition(state, event);
    if (next !== state) {
      state = next;
      for (const notify of listeners) {
        notify();
      }
    }
  }

  async function drain() {
    while (state.phase.kind === 'idle' && state.queued.length) {
      const [job] = state.queued;
      const {edit} = job.entry;
      dispatch({type: 'started', job});

      const result = await adapter
        .persist(edit, job.kind)
        .catch((error: unknown): EditResult => ({
          issues: [{kind: 'unexpectedFailure', error}],
        }));
      dispatch({type: 'settled', job, result, splitId: Symbol()});
      if (result.issues.length) {
        const issues = await adapter
          .recover(edit)
          .catch((error: unknown): WriteIssue[] => [{kind: 'unexpectedFailure', error}]);
        dispatch({type: 'recovered', issues});
      }
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    save(edit: Edit) {
      if (edit.changes.length) {
        dispatch({type: 'save', entry: {kind: 'edit', id: Symbol(), edit}});
        void drain();
      }
    },
    replay(direction: 'undo' | 'redo') {
      dispatch({type: 'replay', direction});
      void drain();
    },
    clearIssues: () => dispatch({type: 'clearIssues'}),
  };
}
