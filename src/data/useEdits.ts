import {useEffect, useMemo, useSyncExternalStore} from 'react';

import {toast} from 'sonner';

import type {Row} from './api';
import {projectedHistory, projectRows} from './editQueue';
import type {Session} from './session';

export function useEdits({edits}: Session, rows: Row[]) {
  const state = useSyncExternalStore(edits.subscribe, edits.getState);
  const {phase, queued, issues} = state;
  const history = useMemo(() => projectedHistory(state), [state]);
  const visibleRows = useMemo(
    () => projectRows(phase, queued, rows),
    [phase, queued, rows],
  );

  useEffect(() => {
    let previous = edits.getState().completion;
    return edits.subscribe(() => {
      const result = edits.getState().completion;
      if (!result || result === previous) {
        return;
      }
      previous = result;
      const {kind, label, receipt} = result;
      const count = receipt.written.length;
      if (kind === 'save' && count) {
        toast.success(label, {
          description:
            count + (count === 1 ? ' transaction saved' : ' transactions saved'),
        });
      } else if (kind !== 'save' && (count || receipt.alreadySatisfied.size)) {
        toast.success(kind === 'undo' ? 'Undo complete' : 'Redo complete', {
          description: label,
        });
      } else if (!receipt.issues.length) {
        toast.info('No changes to save.');
      }
    });
  }, [edits]);

  return {
    busy: phase.kind !== 'idle',
    rows: visibleRows,
    issues,
    clearIssues: edits.clearIssues,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    save: edits.save,
    replay: edits.replay,
  };
}
