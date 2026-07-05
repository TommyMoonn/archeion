type Identified = {
  id: string;
};

export type ReconciledItems<T> = {
  changed: boolean;
  items: T[];
};

export function shallowEqualRecords<T extends object>(
  left: T,
  right: T,
): boolean {
  const leftKeys = Object.keys(left) as Array<keyof T>;
  const rightKeys = Object.keys(right) as Array<keyof T>;
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.is(left[key], right[key]))
  );
}

export function reconcileById<T extends Identified>(
  previous: T[],
  incoming: T[],
  isEqual: (left: T, right: T) => boolean = shallowEqualRecords,
): ReconciledItems<T> {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const items = incoming.map((item) => {
    const current = previousById.get(item.id);
    return current && isEqual(current, item) ? current : item;
  });
  const changed =
    items.length !== previous.length ||
    items.some((item, index) => item !== previous[index]);

  return { changed, items: changed ? items : previous };
}
