// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { commandDefinitions } from "../features/commands/commandBindings";
import { AppPreferencesStore } from "./appPreferencesStore";

const legacyCustomBinding = {
  alt: false,
  ctrl: true,
  key: "k",
  meta: false,
  shift: true,
} as const;

const customBinding = {
  alt: false,
  key: "k",
  primary: true,
  shift: true,
} as const;

describe("keyboard preference persistence", () => {
  it("normalizes, saves, and reloads a valid override by stable command id", async () => {
    let persisted: unknown = {
      density: "compact",
      keyboard: {
        shortcuts: {
          [commandDefinitions.quickActions.id]: { binding: legacyCustomBinding },
          "removed.command": {
            binding: { ...legacyCustomBinding, key: "u" },
          },
        },
      },
    };
    const saveBrowserFallback = vi.fn((preferences) => {
      persisted = structuredClone(preferences);
    });
    const persistence = {
      isDesktop: () => false,
      loadDesktop: vi.fn(async () => ({})),
      readLegacy: () => persisted,
      removeLegacy: vi.fn(),
      saveBrowserFallback,
      saveDesktop: vi.fn(async () => undefined),
    };
    const store = new AppPreferencesStore(persistence);

    await store.initialize();

    expect(store.getSnapshot().density).toBe("compact");
    expect(store.getSnapshot().keyboard).toEqual({
      shortcuts: {
        [commandDefinitions.quickActions.id]: { binding: customBinding },
      },
    });

    await store.update({
      keyboard: {
        shortcuts: {
          [commandDefinitions.settings.id]: { disabled: true },
        },
      },
    });

    expect(saveBrowserFallback).toHaveBeenCalledTimes(1);
    const reloaded = new AppPreferencesStore(persistence);
    await reloaded.initialize();
    expect(reloaded.getSnapshot().keyboard).toEqual({
      shortcuts: {
        [commandDefinitions.settings.id]: { disabled: true },
      },
    });
    expect(reloaded.getSnapshot().density).toBe("compact");
  });
});
