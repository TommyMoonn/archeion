export function bookAddedTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;

  // Accept ISO dates and explicit-zone timestamps without Date.parse's legacy heuristics.
  const timestamp = value.trim();
  const date =
    /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(
      timestamp,
    )?.[1];
  if (!date) return undefined;

  const calendarDate = new Date(date);
  if (
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== date
  ) {
    return undefined;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}
