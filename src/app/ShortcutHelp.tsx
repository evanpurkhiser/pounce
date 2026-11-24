import {editActions, reviewShortcut} from '../transactions/transactionActions';
import {CheckboxIcon} from '../ui/CheckboxIcon';
import {KeyboardShortcut} from '../ui/KeyboardShortcut';
import ui from '../ui/ui.module.css';

import styles from './ShortcutHelp.module.css';

type ShortcutRow = [action: string, ...bindings: string[][]];

const groups: Array<{title: string; rows: ShortcutRow[]}> = [
  {
    title: 'General',
    rows: [
      ['Open command palette', ['cmd-k'], ['ctrl-k']],
      ['Show keyboard shortcuts', ['?']],
      ['Toggle monthly budget', [']']],
      ['Undo', ['cmd-z'], ['ctrl-z']],
      ['Redo', ['cmd-shift-z'], ['ctrl-shift-z']],
    ],
  },
  {
    title: 'Navigation',
    rows: [
      ['Move up a row', ['↑'], ['k']],
      ['Move down a row', ['↓'], ['j']],
      ['Move left a column', ['←'], ['shift-Tab']],
      ['Move right a column', ['→'], ['Tab']],
      ['Jump half a page up', ['ctrl-u']],
      ['Jump half a page down', ['ctrl-d']],
      ['Jump to first row', ['g', 'g']],
      ['Jump to last row', ['shift-g']],
      ['Previous month', ['{']],
      ['Next month', ['}']],
      ['Go to month', ['g', 'm']],
      ['Go to current month', ['g', 't']],
    ],
  },
  {
    title: 'Selection',
    rows: [
      ['Toggle row selection', ['x']],
      ['Select through focused row', ['shift-x']],
      ['Extend selection up', ['shift-↑'], ['shift-k']],
      ['Extend selection down', ['shift-↓'], ['shift-j']],
      ['Select visible results', ['cmd-a'], ['ctrl-a']],
      ['Clear focus or selection', ['Esc']],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ...Object.values(editActions).map(({label, key}): ShortcutRow => [label, [key]]),
      ['Toggle review status', [reviewShortcut]],
      ['Reset highlighted tag change', ['alt-Enter']],
    ],
  },
  {
    title: 'Sorting and filtering',
    rows: [
      ['Open sort options', ['s']],
      ['Open filters', ['f']],
      ['Clear filters', ['ctrl-f']],
      ['Toggle highlighted filter value', ['cmd-Enter'], ['ctrl-Enter']],
    ],
  },
  {
    title: 'Commands and pickers',
    rows: [
      ['Highlight previous result', ['↑'], ['ctrl-p'], ['ctrl-k']],
      ['Highlight next result', ['↓'], ['ctrl-n'], ['ctrl-j']],
    ],
  },
];

export function ShortcutHelp({
  letterKeys,
  setLetterKeys,
}: {
  letterKeys: boolean;
  setLetterKeys: (enabled: boolean) => void;
}) {
  return (
    <div className={styles.help}>
      {groups.map(({title, rows}) => (
        <section key={title}>
          <h3 className={styles.heading}>{title}</h3>
          <dl className={styles.rows}>
            {rows.map(([action, ...bindings]) => (
              <div className={styles.row} key={action}>
                <dt>{action}</dt>
                <dd className={styles.bindings}>
                  {bindings.map((keys, index) => (
                    <span className={styles.binding} key={keys.join(' ')}>
                      {index > 0 && <span>or</span>}
                      <KeyboardShortcut keys={keys} />
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <label className={ui.checkbox}>
        <input
          className={ui.visuallyHidden}
          type="checkbox"
          checked={letterKeys}
          onChange={event => setLetterKeys(event.target.checked)}
        />
        <CheckboxIcon state={letterKeys ? 'checked' : 'unchecked'} />
        Single-letter shortcuts
      </label>
    </div>
  );
}
