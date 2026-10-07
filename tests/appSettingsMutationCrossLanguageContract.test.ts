import { describe, expect, it } from "vitest";

import {
  AppPreferencesStore,
  applyAppSettingsMutation,
  createAppSettingsMutations,
  normalizeAppPreferences,
} from "../src/stores/appPreferencesStore";
import type { AppSettingsMutation, AppSettingsSnapshot } from "../src/types/appSettings";
import mutationCorpus from "./fixtures/app-settings-mutations/v3.json";
import settingsCorpus from "./fixtures/app-settings/v4.json";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeExpected(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch) || "kind" in patch) return structuredClone(patch);
  const merged: JsonObject = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = key in merged ? mergeExpected(merged[key], value) : structuredClone(value);
  }
  return merged;
}

function expectedSnapshot(step: (typeof mutationCorpus.cases)[number]["steps"][number]) {
  return {
    revision: step.expected.revision,
    preferences: mergeExpected(settingsCorpus.defaults, step.expected.preferencesPatch),
  };
}

describe("shared app settings mutation contract", () => {
  it("uses the current versioned mutation corpus", () => {
    expect(mutationCorpus.version).toBe(3);
  });

  it.each(mutationCorpus.cases)("$name", async ({ steps }) => {
    let preferences = normalizeAppPreferences(settingsCorpus.defaults);
    let listener: ((snapshot: AppSettingsSnapshot) => void) | undefined;
    const store = new AppPreferencesStore({
      isDesktop: () => true,
      loadDesktop: async () => ({ revision: 0, preferences: settingsCorpus.defaults }),
      mutateDesktop: async () => {
        throw new Error("Fixture snapshots should arrive through the native subscription.");
      },
      readLegacy: () => null,
      removeLegacy: () => undefined,
      saveBrowserFallback: () => undefined,
      subscribeDesktop: async (callback) => {
        listener = callback as (snapshot: AppSettingsSnapshot) => void;
        return () => undefined;
      },
    });
    await store.initialize();

    for (const step of steps) {
      const serialized = JSON.parse(JSON.stringify(step.mutation));
      const mutation = serialized as AppSettingsMutation;
      expect(serialized).toEqual(step.mutation);
      const next = applyAppSettingsMutation(preferences, mutation);
      if (!("emittedByFrontend" in step) || step.emittedByFrontend !== false) {
        expect(createAppSettingsMutations(preferences, next)).toEqual([mutation]);
      }
      preferences = next;
      const expected = expectedSnapshot(step);
      expect({ revision: step.expected.revision, preferences }).toEqual(expected);

      listener?.(expected as AppSettingsSnapshot);
      expect(store.getRevisionSnapshot()).toBe(expected.revision);
      expect(store.getSnapshot()).toEqual(expected.preferences);
    }

    const final = expectedSnapshot(steps[steps.length - 1]);
    listener?.({ revision: final.revision - 1, preferences: settingsCorpus.defaults });
    expect(store.getRevisionSnapshot()).toBe(final.revision);
    expect(store.getSnapshot()).toEqual(final.preferences);
  });
});
