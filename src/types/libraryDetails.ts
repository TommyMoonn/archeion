export const BOOK_DETAILS_MIN_WIDTH = 280;
export const BOOK_DETAILS_DEFAULT_WIDTH = 336;
export const BOOK_DETAILS_MAX_WIDTH = 480;

export function normalizeBookDetailsWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(BOOK_DETAILS_MAX_WIDTH, Math.max(BOOK_DETAILS_MIN_WIDTH, value)))
    : BOOK_DETAILS_DEFAULT_WIDTH;
}
