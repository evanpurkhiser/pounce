import {toast} from 'sonner';
import {useRef, useState} from 'react';
import {message, type Edit, type Session} from './data';
import type {Update} from './api';

export function useEdits(session: Session) {
  const [undo, setUndo] = useState<Edit[]>([]);
  const [redo, setRedo] = useState<Edit[]>([]);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const active = useRef(false);

  async function run(work: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setIssues([]);
    try {
      await work();
    } catch (error) {
      setIssues([message(error)]);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  function save(label: string, updates: Update[]) {
    void run(async () => {
      const result = await session.write(label, async () => updates);
      const count = result.edit.changes.length;
      setIssues(result.issues);
      if (count) {
        setUndo([...undo, result.edit]);
        setRedo([]);
        toast.success(label, {description: count + (count === 1 ? ' transaction saved' : ' transactions saved')});
      } else if (!result.issues.length) {
        toast.info('No changes to save.');
      }
    });
  }

  function replay(direction: 'undo' | 'redo') {
    const source = direction === 'undo' ? undo : redo;
    const moveBack = direction === 'undo' ? setUndo : setRedo;
    const moveForward = direction === 'undo' ? setRedo : setUndo;
    const original = source.at(-1);
    if (!original) return;

    void run(async () => {
      const result = await session.replay(original, direction);
      const completed = new Set(result.edit.changes.map(change => change.id));
      const remaining = original.changes.filter(change => !completed.has(change.id));
      const moved = original.changes.filter(change => completed.has(change.id));
      if (result.issues.length) setIssues(result.issues);
      if (moved.length) {
        moveBack([...source.slice(0, -1), ...(remaining.length ? [{...original, changes: remaining}] : [])]);
        moveForward(stack => [...stack, {...original, changes: moved}]);
        toast.success(direction === 'undo' ? 'Undo complete' : 'Redo complete', {description: original.label});
      } else if (!result.issues.length) {
        toast.info('No changes to save.');
      }
    });
  }

  return {busy, issues, clearIssues: () => setIssues([]), canUndo: !!undo.length, canRedo: !!redo.length, save, replay};
}
