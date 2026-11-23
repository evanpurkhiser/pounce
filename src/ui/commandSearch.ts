import type {LucideIcon} from 'lucide-react';

import {rank, type Searchable} from './search';

export type CommandItem = Searchable & {
  id: string;
  group: string;
  groupLabel?: string;
  shortcut?: string;
  detail?: string;
  icon?: LucideIcon;
  checked?: boolean;
  invoke: () => void;
  toggle?: () => void;
  submenu?: {
    items: () => readonly CommandItem[];
    search: 'inline' | 'qualified';
  };
};

function normalized(query: string) {
  return query.replaceAll(/[›>]/g, ' ').trim().replaceAll(/\s+/g, ' ');
}

function qualifiedScope(items: readonly CommandItem[], query: string) {
  const lower = query.toLowerCase();
  let match: {item: CommandItem; prefix: string} | undefined;
  for (const item of items) {
    if (!item.submenu) {
      continue;
    }
    for (const name of [item.label, ...(item.aliases ?? [])]) {
      const prefix = `${normalized(name).toLowerCase()} `;
      if (lower.startsWith(prefix) && prefix.length > (match?.prefix.length ?? 0)) {
        match = {item, prefix};
      }
    }
  }
  return match;
}

function scopedMatches(
  items: readonly CommandItem[],
  query: string,
  trail: readonly CommandItem[] = [],
) {
  const scope = qualifiedScope(items, query);
  if (scope?.item.submenu) {
    return scopedMatches(scope.item.submenu.items(), query.slice(scope.prefix.length), [
      ...trail,
      scope.item,
    ]);
  }

  const direct = items.map(item => ({...item, trail}));
  if (!query) {
    return direct;
  }

  // Bare queries may cross one opted-in submenu edge. An explicit prefix moves the search scope.
  const inline = items.flatMap(item =>
    item.submenu?.search === 'inline'
      ? item.submenu
          .items()
          .filter(child => !items.includes(child))
          .map(child => ({...child, trail: [...trail, item]}))
      : [],
  );
  return rank([...direct, ...inline], query);
}

export function searchCommands(items: readonly CommandItem[], input: string) {
  return scopedMatches(items, normalized(input)).map(({trail, ...item}) => ({
    ...item,
    key: JSON.stringify([...trail.map(parent => parent.id), item.id]),
    label: [...trail.map(parent => parent.label), item.groupLabel, item.label]
      .filter(Boolean)
      .join(' › '),
    group: trail.length ? 'Matches' : item.group,
  }));
}
