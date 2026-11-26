export type BookMenuPlacement = "card" | "row";

export function getBookMenuClassName(placement: BookMenuPlacement): string {
  return `book-menu book-menu--${placement} absolute z-2 ${placement === "card" ? "top-book-menu-card-inset right-book-menu-card-inset" : "top-1/2 end-book-menu-row-inset -translate-y-1/2"}`;
}
