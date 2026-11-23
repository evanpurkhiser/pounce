export type Selection = {
  independent: ReadonlySet<number>;
  range: ReadonlySet<number>;
  anchor?: number;
};

export function emptySelection(): Selection {
  return {independent: new Set(), range: new Set()};
}

export function selectedKeys(selection: Selection) {
  return new Set([...selection.independent, ...selection.range]);
}

export function toggleRow(selection: Selection, id: number): Selection {
  const independent = selectedKeys(selection);
  if (independent.has(id)) {
    independent.delete(id);
  } else {
    independent.add(id);
  }
  return {independent, range: new Set(), anchor: id};
}

export function restrictSelection(selection: Selection, visible: Set<number>): Selection {
  const independent = new Set([...selection.independent].filter(id => visible.has(id)));
  const range = new Set([...selection.range].filter(id => visible.has(id)));
  const anchor =
    selection.anchor !== undefined && visible.has(selection.anchor)
      ? selection.anchor
      : undefined;
  if (
    independent.size === selection.independent.size &&
    range.size === selection.range.size &&
    anchor === selection.anchor
  ) {
    return selection;
  }
  return {independent, range, anchor};
}

export function selectRange(
  selection: Selection,
  order: number[],
  from: number,
  to: number,
  moving: boolean,
): Selection {
  const anchor =
    selection.anchor !== undefined && order.includes(selection.anchor)
      ? selection.anchor
      : from;
  const a = order.indexOf(anchor),
    b = order.indexOf(to);
  const range = moving && a === b ? [] : order.slice(Math.min(a, b), Math.max(a, b) + 1);
  return {...selection, anchor, range: new Set(range)};
}
