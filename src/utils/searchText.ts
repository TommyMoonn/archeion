export type SearchTextVariants = {
  raw: string;
  normalized: string;
  compact: string;
  tokens: string[];
};

export type SearchQuery = {
  normalized: string;
  compact: string;
  terms: string[];
  compactTerms: string[];
};

const COMBINING_MARKS_PATTERN = /\p{Diacritic}/gu;
const WORD_APOSTROPHE_PATTERN = /(?<=[\p{Letter}\p{Number}])['’‘`´](?=[\p{Letter}\p{Number}])/gu;
const NON_SEARCH_CHARACTER_PATTERN = /[^\p{Letter}\p{Number}]+/gu;
const WHITESPACE_PATTERN = /\s+/g;

function toBaseSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS_PATTERN, "")
    .replace(/[’‘`´]/g, "'");
}

export function normalizeSearchText(value: string): string {
  return toBaseSearchText(value)
    .replace(WORD_APOSTROPHE_PATTERN, "")
    .replace(NON_SEARCH_CHARACTER_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

export function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(WHITESPACE_PATTERN, "");
}

export function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);

  return normalized ? normalized.split(" ") : [];
}

export function createSearchTextVariants(value: string | null | undefined): SearchTextVariants {
  const raw = value ?? "";
  const normalized = normalizeSearchText(raw);
  const compact = normalized.replace(WHITESPACE_PATTERN, "");

  return {
    raw,
    normalized,
    compact,
    tokens: normalized ? normalized.split(" ") : [],
  };
}

export function createSearchQuery(query: string): SearchQuery {
  const normalized = normalizeSearchText(query);
  const terms = normalized ? normalized.split(" ") : [];

  return {
    normalized,
    compact: normalized.replace(WHITESPACE_PATTERN, ""),
    terms,
    compactTerms: terms.map((term) => term.replace(WHITESPACE_PATTERN, "")),
  };
}

export function isEmptySearchQuery(query: SearchQuery): boolean {
  return query.terms.length === 0;
}

export function searchFieldMatchesTerm(
  field: SearchTextVariants,
  term: string,
  compactTerm = term,
): boolean {
  if (!term) {
    return true;
  }

  return (
    field.tokens.some((token) => token === term || token.startsWith(term)) ||
    field.normalized.includes(term) ||
    Boolean(compactTerm && field.compact.includes(compactTerm))
  );
}

export function scoreSearchField(
  field: SearchTextVariants,
  query: SearchQuery,
): number {
  if (isEmptySearchQuery(query) || !field.normalized) {
    return 0;
  }

  let score = 0;

  if (field.normalized === query.normalized) {
    score += 600;
  } else if (field.compact === query.compact) {
    score += 560;
  } else if (field.normalized.startsWith(query.normalized)) {
    score += 440;
  } else if (field.compact.startsWith(query.compact)) {
    score += 400;
  } else if (field.normalized.includes(query.normalized)) {
    score += 260;
  } else if (field.compact.includes(query.compact)) {
    score += 240;
  }

  for (const [index, term] of query.terms.entries()) {
    const compactTerm = query.compactTerms[index] ?? term;

    if (field.tokens.includes(term)) {
      score += 120;
    } else if (field.tokens.some((token) => token.startsWith(term))) {
      score += 95;
    } else if (field.normalized.includes(term)) {
      score += 60;
    } else if (compactTerm && field.compact.includes(compactTerm)) {
      score += 55;
    }
  }

  return score;
}

export function searchFieldsMatchQuery(
  fields: SearchTextVariants[],
  query: SearchQuery,
): boolean {
  if (isEmptySearchQuery(query)) {
    return true;
  }

  return query.terms.every((term, index) =>
    fields.some((field) =>
      searchFieldMatchesTerm(field, term, query.compactTerms[index] ?? term),
    ),
  );
}
