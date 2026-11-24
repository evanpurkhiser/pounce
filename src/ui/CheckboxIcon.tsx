import {Square, SquareCheckBig, SquareMinus} from 'lucide-react';

import ui from './ui.module.css';

const icons = {unchecked: Square, mixed: SquareMinus, checked: SquareCheckBig};

export type CheckboxState = keyof typeof icons;

export function CheckboxIcon({
  state,
  className,
}: {
  state: CheckboxState;
  className?: string;
}) {
  const Icon = icons[state];
  return (
    <Icon
      aria-hidden
      className={className ? `${ui.actionIcon} ${className}` : ui.actionIcon}
    />
  );
}
