import {useEffect, useMemo, useSyncExternalStore} from 'react';

import {toast} from 'sonner';

import type {Row} from './api';
import {message} from './editChanges';
import {projectedHistory, projectRows, type EditIssue} from './editQueue';
import type {Session} from './session';

function issueMessage(issue: EditIssue): string {
  switch (issue.kind) {
    case 'unavailable':
      return `Transaction #${issue.id} is unavailable.`;
    case 'missingConfirmation':
      return `Missing write confirmation for #${issue.id}.`;
    case 'conflict':
      return `Transaction #${issue.id} changed in Lunch Money (${issue.fields.join(', ')}).`;
    case 'differentValue':
      return `#${issue.id} returned a different value from Lunch Money (${issue.fields.join(', ')}).`;
    case 'requestFailed': {
      const ids = issue.ids.map(id => `#${id}`).join(', ');
      return issue.operation === 'read'
        ? `Could not read ${ids} from Lunch Money. ${message(issue.error)}`
        : `${ids} · ${message(issue.error)}`;
    }
    case 'cacheUpdateFailed':
      return `Could not update transaction #${issue.id} locally. ${message(issue.error)}`;
    case 'unexpectedFailure':
      return message(issue.error);
    case 'discarded':
      return `${issue.count} queued ${issue.count === 1 ? 'edit was' : 'edits were'} discarded.`;
    case 'refreshFailed':
      return `Could not refresh transactions. ${issue.issues.map(issueMessage).join(' ')}`;
  }
}

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
    issues: issues.map(issueMessage),
    clearIssues: edits.clearIssues,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    save: edits.save,
    replay: edits.replay,
  };
}
