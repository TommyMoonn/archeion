/** Wrap through enabled rows without moving DOM focus out of the owning control. */
export function getNextEnabledIndex(
  options: readonly { disabled?: boolean }[],
  startIndex: number,
  direction: 1 | -1,
): number {
  if (!options.length) return -1;

  let nextIndex = startIndex;
  for (let count = 0; count < options.length; count += 1) {
    nextIndex = (nextIndex + direction + options.length) % options.length;
    if (!options[nextIndex]?.disabled) return nextIndex;
  }
  return -1;
}
