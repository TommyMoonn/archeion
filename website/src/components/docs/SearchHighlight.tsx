import { normalizeSearch } from "../../search/match";

export function SearchHighlight({ text, query }: { text: string; query: string }) {
  const tokens = normalizeSearch(query).split(" ").filter(Boolean);
  if (!tokens.length) return <>{text}</>;
  const pattern = new RegExp(
    tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "giu",
  );
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(end, match.index));
    parts.push(
      <mark key={match.index} className="rounded-sm bg-accent-subtle text-content-strong">
        {match[0]}
      </mark>,
    );
    end = match.index + match[0].length;
  }
  parts.push(text.slice(end));
  return <>{parts}</>;
}
