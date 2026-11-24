import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronUp,
  Command,
  Option,
} from 'lucide-react';

import styles from './KeyboardShortcut.module.css';
import ui from './ui.module.css';

const keyIcons = new Map([
  ['shift', {label: 'Shift', icon: ArrowBigUp}],
  ['cmd', {label: 'Command', icon: Command}],
  ['ctrl', {label: 'Control', icon: ChevronUp}],
  ['alt', {label: 'Alt', icon: Option}],
  ['←', {label: 'Left Arrow', icon: ArrowLeft}],
  ['→', {label: 'Right Arrow', icon: ArrowRight}],
  ['↑', {label: 'Up Arrow', icon: ArrowUp}],
  ['↓', {label: 'Down Arrow', icon: ArrowDown}],
]);

export function KeyboardShortcut({keys}: {keys: readonly string[]}) {
  if (keys.length === 0) {
    return null;
  }

  const presses = keys.map(press =>
    press.split(/-(?=.)/).map(
      key =>
        keyIcons.get(key.toLowerCase()) ?? {
          label: key.length === 1 ? key.toUpperCase() : key,
          icon: null,
        },
    ),
  );

  return (
    <kbd className={styles.shortcut}>
      <span className={ui.visuallyHidden}>
        {presses.map(press => press.map(key => key.label).join('+')).join(', then ')}
      </span>
      {presses.map((press, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- A shortcut can repeat a press, and only its position distinguishes it.
        <span key={index} className={styles.press} aria-hidden>
          {press.map(({label, icon: Icon}) =>
            Icon ? (
              <Icon key={label} />
            ) : (
              <span key={label} className={styles.key}>
                {label}
              </span>
            ),
          )}
        </span>
      ))}
    </kbd>
  );
}
