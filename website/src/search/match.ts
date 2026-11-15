import type { SearchEntry } from "./types";

export const normalizeSearch = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function matches(text: string, query: string) {
  const normalized = normalizeSearch(text);
  return query.split(" ").every((token) => normalized.includes(token));
}

export function searchRank(entry: SearchEntry, query: string): number {
  if (!query) return entry.sectionId ? -1 : 0;
  if (!entry.sectionId && [entry.title, entry.heading].some((text) => matches(text, query)))
    return 0;
  if (entry.sectionId && matches(entry.sectionHeading, query)) return 1;
  if (entry.aliases.some((alias) => matches(alias, query))) return 2;
  return matches(
    entry.sectionId ? entry.text : `${entry.text} ${entry.description} ${entry.group}`,
    query,
  )
    ? 3
    : -1;
}

export function searchEntries(entries: SearchEntry[], input: string, limit = 10) {
  const query = normalizeSearch(input);
  const matches = entries
    .map((entry, order) => ({ entry, order, rank: searchRank(entry, query) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.order - b.order);
  return { total: matches.length, entries: matches.slice(0, limit).map(({ entry }) => entry) };
}

export function resultAnnouncement(query: string, total: number, shown: number) {
  if (!normalizeSearch(query)) return "";
  if (!total) return "No matching results.";
  return `${total} ${total === 1 ? "result" : "results"} found.${shown < total ? ` Showing first ${shown}.` : ""}`;
}
