import { describe, expect, it } from "vitest";

import {
  compactSearchText,
  createSearchQuery,
  createSearchTextVariants,
  normalizeSearchText,
  searchFieldsMatchQuery,
  tokenizeSearchQuery,
} from "./searchText";

describe("search text normalization", () => {
  it("folds case, diacritics, and apostrophes inside words", () => {
    expect(normalizeSearchText("I'm gonna be...")).toBe("im gonna be");
    expect(normalizeSearchText("I’m gonna be...")).toBe("im gonna be");
    expect(normalizeSearchText("reader's Café")).toBe("readers cafe");
  });

  it("turns punctuation separators into spaces and keeps a compact variant", () => {
    expect(normalizeSearchText("Re:Zero [Vol. 1]")).toBe("re zero vol 1");
    expect(normalizeSearchText("Light-Novel/jp_books")).toBe("light novel jp books");
    expect(compactSearchText("Re:Zero")).toBe("rezero");
  });

  it("tokenizes query text with the same normalization rules", () => {
    expect(tokenizeSearchQuery("  Café / Re:Zero  ")).toEqual(["cafe", "re", "zero"]);
  });

  it("matches spaced and compact query forms against normalized fields", () => {
    const field = createSearchTextVariants("Re:Zero");

    expect(searchFieldsMatchQuery([field], createSearchQuery("re zero"))).toBe(true);
    expect(searchFieldsMatchQuery([field], createSearchQuery("rezero"))).toBe(true);
  });
});
