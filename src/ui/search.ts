import Fuse from 'fuse.js';

export type Searchable = {label: string; aliases?: string[]};

export function rank<T extends Searchable>(items: readonly T[], input: string) {
  const query = input.trim();
  if (!query) {
    return [...items];
  }

  const words = (value: string) =>
    value
      .normalize('NFD')
      .replaceAll(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const queryWords = words(query);
  const prefixes = queryWords.filter(word => word.length < 4);
  const matches = prefixes.length
    ? items.filter(item => {
        const choices = words([item.label, ...(item.aliases ?? [])].join(' '));
        return prefixes.every(prefix =>
          choices.some(choice => choice.startsWith(prefix)),
        );
      })
    : items;
  if (prefixes.length && prefixes.length === queryWords.length) {
    return [...matches];
  }

  return new Fuse(matches, {
    keys: [
      {name: 'label', weight: 0.75},
      {name: 'aliases', weight: 0.25},
    ],
    useTokenSearch: true,
    tokenMatch: 'all',
    ignoreDiacritics: true,
    ignoreLocation: true,
    threshold: 0.35,
  })
    .search(query)
    .map(result => result.item);
}
