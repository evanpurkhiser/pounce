import {useFormatForDisplay, type Hotkey} from '@tanstack/react-hotkeys';

import styles from './KeyboardShortcut.module.css';
import ui from './ui.module.css';

const spokenLabels: Record<string, string> = {
  Cmd: 'Command',
  Ctrl: 'Control',
  ArrowLeft: 'Left Arrow',
  ArrowRight: 'Right Arrow',
  ArrowUp: 'Up Arrow',
  ArrowDown: 'Down Arrow',
};

export function KeyboardShortcut({binding}: {binding: Hotkey}) {
  const format = useFormatForDisplay();
  const steps = typeof binding === 'string' ? [binding] : binding;
  const spoken = format(steps, {parts: true, useSymbols: false})
    .map(chord => chord.map(key => spokenLabels[key] ?? key).join('+'))
    .join(', then ');

  return (
    <kbd className={styles.shortcut}>
      <span className={ui.visuallyHidden}>{spoken}</span>
      <span aria-hidden>
        {format(binding, {keyLabels: {Enter: 'Enter', Tab: 'Tab'}})}
      </span>
    </kbd>
  );
}
