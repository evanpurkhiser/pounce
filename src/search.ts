import Fuse from 'fuse.js';

export type Searchable = {label: string; aliases?: string[]};

export function rank<T extends Searchable>(items: readonly T[], input: string) {
  const query = input.trim();
  if (!query) return [...items];

  return new Fuse(items, {
    keys: [{name: 'label', weight: .75}, {name: 'aliases', weight: .25}],
    useTokenSearch: true,
    tokenMatch: 'all',
    ignoreDiacritics: true,
    ignoreLocation: true,
    threshold: .35,
  }).search(query).map(result => result.item);
}
