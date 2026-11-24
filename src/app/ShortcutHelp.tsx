import type {Hotkey} from '@tanstack/react-hotkeys';

import {editActions, reviewShortcut} from '../transactions/transactionActions';
import {KeyboardShortcut} from '../ui/KeyboardShortcut';
import {shortcuts} from '../ui/shortcuts';

import styles from './ShortcutHelp.module.css';

type ShortcutRow = [action: string, ...bindings: Hotkey[]];

const groups: Array<{title: string; rows: ShortcutRow[]}> = [
  {
    title: 'General',
    rows: [
      ['Open command palette', shortcuts.commands],
      ['Show keyboard shortcuts', shortcuts.help],
      ['Toggle monthly budget', shortcuts.budget],
      ['Undo', shortcuts.undo],
      ['Redo', shortcuts.redo],
    ],
  },
  {
    title: 'Navigation',
    rows: [
      ['Move up a row', 'ArrowUp', shortcuts.previousRow],
      ['Move down a row', 'ArrowDown', shortcuts.nextRow],
      ['Move left a column', 'ArrowLeft', 'Shift+Tab'],
      ['Move right a column', 'ArrowRight', 'Tab'],
      ['Jump half a page up', shortcuts.halfPageUp],
      ['Jump half a page down', shortcuts.halfPageDown],
      ['Jump to first row', shortcuts.firstRow],
      ['Jump to last row', shortcuts.lastRow],
      ['Previous month', shortcuts.previousMonth],
      ['Next month', shortcuts.nextMonth],
      ['Go to month', shortcuts.pickMonth],
      ['Go to current month', shortcuts.currentMonth],
    ],
  },
  {
    title: 'Selection',
    rows: [
      ['Toggle row selection', shortcuts.toggleSelection],
      ['Select through focused row', shortcuts.selectRange],
      ['Extend selection up', 'Shift+ArrowUp', shortcuts.extendSelectionUp],
      ['Extend selection down', 'Shift+ArrowDown', shortcuts.extendSelectionDown],
      ['Select visible results', shortcuts.selectAll],
      ['Clear focus or selection', shortcuts.dismiss],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ...Object.values(editActions).map(({label, key}): ShortcutRow => [label, key]),
      ['Toggle review status', reviewShortcut],
      ['Reset highlighted tag change', shortcuts.resetTag],
    ],
  },
  {
    title: 'Sorting and filtering',
    rows: [
      ['Open sort options', shortcuts.sort],
      ['Open filters', shortcuts.filter],
      ['Clear filters', shortcuts.clearFilters],
      ['Toggle highlighted filter value', shortcuts.toggleFilterValue],
    ],
  },
  {
    title: 'Commands and pickers',
    rows: [
      ['Highlight previous result', 'ArrowUp', 'Control+P', 'Control+K'],
      ['Highlight next result', 'ArrowDown', 'Control+N', 'Control+J'],
    ],
  },
];

export function ShortcutHelp() {
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
                  {bindings.map((binding, index) => (
                    <span
                      className={styles.binding}
                      key={typeof binding === 'string' ? binding : binding.join(' ')}
                    >
                      {index > 0 && <span>or</span>}
                      <KeyboardShortcut binding={binding} />
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
