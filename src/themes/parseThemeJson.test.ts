import { describe, expect, it } from "vitest";

import { parseThemeJson } from "./parseThemeJson";
import { validateThemeManifest } from "./validateThemeManifest";

describe("parseThemeJson", () => {
  it("parses JSON without performing semantic validation", () => {
    const result = parseThemeJson('{"schemaVersion":1,"name":"Theme"}');

    expect(result).toEqual({ ok: true, value: { schemaVersion: 1, name: "Theme" } });
    if (!result.ok) throw new Error("Expected parsed JSON");
    expect(validateThemeManifest(result.value).ok).toBe(false);
  });

  it("returns a root diagnostic instead of throwing for malformed JSON", () => {
    const result = parseThemeJson('{"schemaVersion":');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a parse failure");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: "invalid-json", path: "$" });
  });

  it.each(["null", "[]", '"theme"', "1"])(
    "keeps parsing separate for valid non-object JSON %s",
    (source) => {
      const parsed = parseThemeJson(source);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("Expected parsed JSON");
      const validated = validateThemeManifest(parsed.value);
      expect(validated.ok).toBe(false);
      if (validated.ok) throw new Error("Expected semantic validation failure");
      expect(validated.diagnostics[0]).toMatchObject({ code: "invalid-type", path: "$" });
    },
  );
});
