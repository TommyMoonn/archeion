import { describe, expect, it } from "vitest";

import { formatDictionaryLanguagePair } from "./formatters";

describe("formatDictionaryLanguagePair", () => {
  it("formats matching tags as one monolingual language", () => {
    expect(formatDictionaryLanguagePair("en", "en")).toBe("English");
  });

  it("formats the canonical undetermined tag for manual dictionaries", () => {
    expect(formatDictionaryLanguagePair("und", "und")).toBe("Unknown");
  });

  it("preserves bilingual direction", () => {
    expect(formatDictionaryLanguagePair("fr", "en")).toBe("French → English");
    expect(formatDictionaryLanguagePair("en", "fr")).toBe("English → French");
  });
});
