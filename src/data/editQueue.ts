import type {GroupRef, Row, TransactionRef} from './api';
import {
  editUpdate,
  resolvePatch,
  type Edit,
  type EditKind,
  type WriteIssue,
} from './editChanges';
import {projectGroupRows} from './groupProjection';
import type {GroupEdit} from './transactionGroups';

export type QueuedEdit = Edit<TransactionRef> | GroupEdit;
type Entry = {kind: 'edit'; id: symbol; edit: QueuedEdit};
type Save = {kind: 'save'; entry: Entry};
type Job = Save | {kind: 'undo' | 'redo'; entry: Entry};
type Redo = Entry | Save;
type History = {undo: Entry[]; redo: Redo[]};
type Phase = {kind: 'idle'} | {kind: 'writing'; job: Job} | {kind: 'recovering'};
export type EditResult<T extends QueuedEdit = QueuedEdit> = {
  applied?: T;
  remaining?: T;
  savedCount?: number;
  groupBindings?: {
    removed: number[];
    confirmed: ReadonlyArray<readonly [number, GroupRef]>;
  };
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
  bindings: ReadonlyMap<number, GroupRef>;
  completion?: Completion;
};

type Event =
  | {type: 'save'; entry: Entry}
  | {type: 'replay'; direction: 'undo' | 'redo'; item: Redo}
  | {type: 'started'; job: Job}
  | {type: 'settled'; job: Job; result: EditResult; splitId: symbol}
  | {type: 'recovered'; issues: WriteIssue[]}
  | {type: 'clearIssues'};

type Adapter = {
  persist(
    edit: QueuedEdit,
    kind: EditKind,
    bindings: State['bindings'],
  ): Promise<EditResult>;
  recover(edit: QueuedEdit, bindings: State['bindings']): Promise<WriteIssue[]>;
};

const idle: Phase = {kind: 'idle'};
const initialState: State = {
  phase: idle,
  queued: [],
  history: {undo: [], redo: []},
  issues: [],
  bindings: new Map(),
};

export function pendingJobs(phase: Phase, queued: Job[]) {
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

function recordSave({undo, redo}: History, entry: Entry): History {
  return {undo: [...undo, entry], redo: redo.filter(isDraft)};
}

// Reduce the same intents for the optimistic UI and for the history confirmed
// by receipts. Canceling a pending intent removes its projected effects.
export function projectedHistory({phase, queued, history}: State) {
  return pendingJobs(phase, queued).reduce(
    (current, job) =>
      job.kind === 'save' ? recordSave(current, job.entry) : moveEntry(current, job),
    history,
  );
}

export function projectRows(
  phase: Phase,
  queued: Job[],
  rows: Row[],
  baseCurrency?: Row['currency'],
  bindings?: State['bindings'],
) {
  if (bindings?.size) {
    rows = rows.map(row => {
      const groupRef = bindings.get(row.id);
      return groupRef ? {...row, groupRef} : row;
    });
  }
  const jobs = pendingJobs(phase, queued);
  if (!jobs.length) {
    return rows;
  }

  if (!jobs.some(({entry}) => 'group' in entry.edit)) {
    return projectFieldRows(jobs, rows);
  }

  // Undo can queue while the original group is still saving. The two drafts
  // cancel visually until the save supplies a confirmed membership to undo.
  const reversingDrafts = new Set(
    jobs.flatMap(({kind, entry: {id, edit}}) =>
      kind === 'undo' && 'group' in edit && edit.group.kind !== 'membership' ? [id] : [],
    ),
  );
  return jobs.reduce((visible, job) => {
    const {
      kind,
      entry: {id, edit},
    } = job;
    if (reversingDrafts.has(id)) {
      return visible;
    }

    return 'group' in edit
      ? projectGroupRows(visible, edit.group, kind, baseCurrency)
      : projectFieldRows([job], visible);
  }, rows);
}

function projectFieldRows(jobs: Job[], rows: Row[]) {
  const ids = new Map(
    rows.flatMap(row => (row.groupRef ? [[row.groupRef, row.id] as const] : [])),
  );
  const updates = Map.groupBy(
    jobs.flatMap(({kind, entry: {edit}}) =>
      'changes' in edit ? edit.changes.map(change => editUpdate(change, kind)) : [],
    ),
    ({id}) => (typeof id === 'number' ? id : ids.get(id)),
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

function queueReplay(state: State, direction: 'undo' | 'redo', item: Redo): State {
  const {history, queued} = state;
  const tail = queued.at(-1);
  if (direction === 'undo' && tail?.kind === 'save') {
    return {
      ...state,
      history: {...history, redo: [...history.redo, tail]},
      queued: queued.slice(0, -1),
    };
  }

  if (isDraft(item)) {
    return {
      ...state,
      history: {...history, redo: history.redo.filter(draft => draft !== item)},
      queued: [...queued, item],
    };
  }
  if (
    tail &&
    tail.kind !== 'save' &&
    tail.kind !== direction &&
    tail.entry.id === item.id
  ) {
    return {...state, queued: queued.slice(0, -1)};
  }
  return {...state, queued: [...queued, {kind: direction, entry: item}]};
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
  const updatedQueue = queued.map(item =>
    item.entry.id === entry.id ? {...item, entry: confirmed} : item,
  );
  if (job.kind === 'save') {
    return {history: recordSave(history, confirmed), queued: updatedQueue};
  }

  const unfinished = remaining && {...entry, edit: remaining};
  return {
    history: moveEntry(
      history,
      job,
      unfinished ? {...confirmed, id: splitId} : confirmed,
      unfinished,
    ),
    queued: updatedQueue,
  };
}

function applyGroupBindings(
  bindings: State['bindings'],
  result?: EditResult['groupBindings'],
): State['bindings'] {
  if (!result) {
    return bindings;
  }

  const removed = new Set(result.removed);
  const confirmed = new Set(result.confirmed.map(([, ref]) => ref));
  return new Map([
    ...[...bindings].filter(([id, ref]) => !removed.has(id) && !confirmed.has(ref)),
    ...result.confirmed,
  ]);
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
      return queueReplay(state, event.direction, event.item);
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
      const bindings = applyGroupBindings(state.bindings, result.groupBindings);
      const completion = {kind: job.kind, label: job.entry.edit.label, result};
      if (!result.issues.length) {
        return {...state, ...next, phase: idle, completion, bindings};
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
        bindings,
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
        .persist(edit, job.kind, state.bindings)
        .catch((error: unknown): EditResult => ({
          issues: [{kind: 'unexpectedFailure', error}],
        }));
      dispatch({type: 'settled', job, result, splitId: Symbol()});
      if (result.issues.length) {
        const issues = await adapter
          .recover(edit, state.bindings)
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
    save(edit: QueuedEdit) {
      if ('group' in edit || edit.changes.length) {
        dispatch({type: 'save', entry: {kind: 'edit', id: Symbol(), edit}});
        void drain();
      }
    },
    replay(direction: 'undo' | 'redo') {
      const item = projectedHistory(state)[direction].at(-1);
      if (!item) {
        return;
      }

      dispatch({type: 'replay', direction, item});
      void drain();
      return (isDraft(item) ? item.entry : item).edit;
    },
    clearIssues: () => dispatch({type: 'clearIssues'}),
  };
}
