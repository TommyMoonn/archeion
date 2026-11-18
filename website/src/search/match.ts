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

// Use the original-case excerpt where it contains the match; otherwise show the
// matching part of the full body instead of an unrelated beginning of the page.
export function searchContextExcerpt(entry: SearchEntry, input: string): string | null {
  const query = normalizeSearch(input);
  if (!query || searchRank(entry, query) !== 3) return null;

  const source = matches(entry.text, query)
    ? matches(entry.excerpt, query)
      ? entry.excerpt
      : entry.text
    : matches(entry.description, query)
      ? entry.description
      : null;
  if (!source) return null;

  const text = source.replace(/\s+/g, " ").trim();
  const limit = 160;
  if (text.length <= limit) return text;

  const lower = text.toLowerCase();
  const phrase = lower.indexOf(query);
  const firstToken = query.split(" ").find((token) => lower.includes(token));
  const matchAt = phrase >= 0 ? phrase : firstToken ? lower.indexOf(firstToken) : 0;
  let start = Math.max(0, matchAt - 48);
  if (start > 0) {
    const boundary = text.indexOf(" ", start);
    if (boundary >= 0 && boundary - start <= 16) start = boundary + 1;
  }

  const prefix = start > 0 ? "…" : "";
  let end = Math.min(text.length, start + limit - prefix.length);
  if (end < text.length) {
    end -= 1; // Reserve the trailing ellipsis within the length limit.
    const boundary = text.lastIndexOf(" ", end);
    if (boundary > start + limit / 2) end = boundary;
  }
  return `${prefix}${text.slice(start, end).trimEnd()}${end < text.length ? "…" : ""}`;
}

export function resultAnnouncement(query: string, total: number, shown: number) {
  if (!normalizeSearch(query)) return "";
  if (!total) return "No matching results.";
  return `${total} ${total === 1 ? "result" : "results"} found.${shown < total ? ` Showing first ${shown}.` : ""}`;
}
