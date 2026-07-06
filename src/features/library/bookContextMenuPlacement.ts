export type BookMenuPlacement = "card" | "row";

export function getBookMenuClassName(placement: BookMenuPlacement): string {
  return `book-menu book-menu--${placement}`;
}
