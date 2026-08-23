import { describe, expect, it } from "vitest";

import { findKeyboardPreferenceConflicts } from "../src/features/commands/commandBindings";
import { normalizeAppPreferences } from "../src/stores/appPreferencesStore";
import fixtureCorpus from "./fixtures/app-settings/v2.json";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeExpected(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch)) {
    return structuredClone(patch);
  }
  if ("kind" in patch) {
    return structuredClone(patch);
  }

  const merged: JsonObject = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = key in merged ? mergeExpected(merged[key], value) : structuredClone(value);
  }
  return merged;
}

describe("cross-language app settings contract", () => {
  it("uses the current versioned fixture corpus", () => {
    expect(fixtureCorpus.version).toBe(2);
  });

  it.each(fixtureCorpus.cases)("$name", ({ input, expectedPatch }) => {
    const expected = mergeExpected(fixtureCorpus.defaults, expectedPatch);
    const normalized = normalizeAppPreferences(input);

    expect(normalized).toEqual(expected);
    expect(findKeyboardPreferenceConflicts(normalized.keyboard)).toEqual([]);
    expect(normalizeAppPreferences(JSON.parse(JSON.stringify(normalized)))).toEqual(expected);
  });

  it("emits only the current schema for legacy and future input", () => {
    const legacyCase = fixtureCorpus.cases.find(
      ({ name }) => name === "legacy Library values migrate without sibling loss",
    );
    const futureCase = fixtureCorpus.cases.find(
      ({ name }) => name === "obsolete and future fields are ignored",
    );

    expect(legacyCase).toBeDefined();
    expect(futureCase).toBeDefined();

    const legacyOutput = normalizeAppPreferences(legacyCase?.input);
    const futureOutput = normalizeAppPreferences(futureCase?.input);

    expect(legacyOutput).not.toHaveProperty("bookCardSize");
    expect(legacyOutput.library).not.toHaveProperty("sortBy");
    expect(legacyOutput.library).not.toHaveProperty("viewMode");
    expect(futureOutput).not.toHaveProperty("windowFrameStyle");
    expect(futureOutput).not.toHaveProperty("futureSchemaField");
    expect(futureOutput.appearance).not.toHaveProperty("futureMotionPolicy");
  });
});
