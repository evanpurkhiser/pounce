import type {CSSProperties} from 'react';

import type {TagChoice} from '../data/api';

import styles from './TransactionTag.module.css';

export function TransactionTag({label, color}: Omit<TagChoice, 'id'>) {
  const colors: CSSProperties & {'--tag-swatch'?: string} = {
    '--tag-swatch': color,
  };

  return (
    <span
      className={styles.tag}
      data-custom-color={color ? '' : undefined}
      style={colors}
      title={label}
    >
      {label}
    </span>
  );
}
