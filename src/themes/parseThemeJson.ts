import type { ThemeJsonParseResult } from "./domain";

export function parseThemeJson(source: string): ThemeJsonParseResult {
  try {
    return Object.freeze({ ok: true, value: JSON.parse(source) as unknown });
  } catch (error) {
    const detail = error instanceof SyntaxError ? error.message : "Unknown JSON parsing error.";
    return Object.freeze({
      ok: false,
      diagnostics: Object.freeze([
        Object.freeze({
          code: "invalid-json" as const,
          path: "$",
          message: `Theme manifest is not valid JSON. ${detail}`,
        }),
      ]),
    });
  }
}
