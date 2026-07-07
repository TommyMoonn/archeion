import { describe, expect, it, vi } from "vitest";

import {
  AppPreferencesStore,
  normalizeAppPreferences,
} from "./appPreferencesStore";

function createPersistence(overrides: Partial<ConstructorParameters<typeof AppPreferencesStore>[0]> = {}) {
  return {
    isDesktop: () => true,
    loadDesktop: async () => ({}),
    readLegacy: () => null,
    removeLegacy: vi.fn(),
    saveBrowserFallback: vi.fn(),
    saveDesktop: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("app preferences", () => {
  it("uses defaults for missing and invalid values", () => {
    expect(normalizeAppPreferences(null)).toMatchObject({
      appThemePreset: "dark",
      density: "comfortable",
      bookCardSize: "medium",
      showContinueReading: true,
      startupBehavior: "open-last-archive",
      windowFrameStyle: "hidden",
      library: {
        viewMode: "grid",
        sortBy: "title",
      },
      reader: {
        fontSize: 18,
        progressPlacement: "top",
      },
      import: {
        defaultConflictAction: "keepBoth",
        defaultMode: "copy",
      },
      filesAndMetadata: {
        liveWatcherEnabled: true,
        scanOnStartup: true,
      },
    });
    expect(
      normalizeAppPreferences({
        appThemePreset: "custom",
        density: "dense",
        bookCardSize: "huge",
        startupBehavior: "unknown",
        windowFrameStyle: "custom",
        library: { viewMode: "columns", sortBy: "folder" },
        reader: { fontSize: Number.NaN, progressPlacement: "bottom" },
        import: { defaultMode: "link", defaultConflictAction: "merge" },
      }),
    ).toMatchObject({
      appThemePreset: "dark",
      density: "comfortable",
      bookCardSize: "medium",
      startupBehavior: "open-last-archive",
      windowFrameStyle: "hidden",
      library: {
        viewMode: "grid",
        sortBy: "title",
      },
      reader: {
        fontSize: 18,
        progressPlacement: "top",
      },
      import: {
        defaultConflictAction: "keepBoth",
        defaultMode: "copy",
      },
    });
  });

  it("retains supported settings", () => {
    expect(
      normalizeAppPreferences({
        appThemePreset: "light",
        density: "compact",
        bookCardSize: "large",
        confirmDestructiveFileActions: false,
        filesAndMetadata: {
          liveWatcherEnabled: false,
          scanOnStartup: false,
        },
        import: {
          defaultConflictAction: "replace",
          defaultMode: "move",
        },
        library: {
          viewMode: "list",
          sortBy: "author",
        },
        reader: {
          fontSize: 22,
          fontFamily: "sans",
          lineHeight: 1.8,
          margin: 64,
          theme: "sepia",
          progressPlacement: "side",
        },
        rememberWindowState: true,
        restoreLastReader: true,
        showContinueReading: false,
        startupBehavior: "show-archive-manager",
        windowFrameStyle: "native",
      }),
    ).toEqual({
      appThemePreset: "light",
      density: "compact",
      bookCardSize: "large",
      confirmDestructiveFileActions: false,
      filesAndMetadata: {
        liveWatcherEnabled: false,
        scanOnStartup: false,
      },
      import: {
        defaultConflictAction: "replace",
        defaultMode: "move",
      },
      library: {
        viewMode: "list",
        sortBy: "author",
      },
      reader: {
        fontSize: 22,
        fontFamily: "sans",
        lineHeight: 1.8,
        margin: 64,
        theme: "sepia",
        progressPlacement: "side",
      },
      rememberWindowState: true,
      restoreLastReader: true,
      showContinueReading: false,
      startupBehavior: "show-archive-manager",
      windowFrameStyle: "native",
    });
  });

  it("migrates legacy localStorage preferences into desktop app config", async () => {
    const saveDesktop = vi.fn(async () => undefined);
    const removeLegacy = vi.fn();
    const store = new AppPreferencesStore(
      createPersistence({
        loadDesktop: async () => ({ density: "comfortable" }),
        readLegacy: () => ({
          density: "compact",
          bookCardSize: "large",
          showContinueReading: false,
        }),
        removeLegacy,
        saveDesktop,
      }),
    );

    await store.initialize();

    expect(store.getSnapshot()).toMatchObject({
      density: "compact",
      bookCardSize: "large",
      showContinueReading: false,
    });
    expect(saveDesktop).toHaveBeenCalledWith(
      expect.objectContaining({ density: "compact" }),
    );
    expect(removeLegacy).toHaveBeenCalledTimes(1);
  });

  it("surfaces app settings save failures", async () => {
    const store = new AppPreferencesStore(
      createPersistence({
        saveDesktop: vi.fn(async () => {
          throw new Error("disk full");
        }),
      }),
    );
    await store.initialize();

    await expect(store.update({ density: "compact" })).rejects.toThrow(
      /disk full/,
    );
    expect(store.getPersistenceSnapshot()).toEqual({
      status: "error",
      error: expect.stringContaining("disk full"),
    });
  });

  it("does not overwrite a user change with a late async load", async () => {
    let resolveLoad: (value: unknown) => void = () => undefined;
    const store = new AppPreferencesStore(
      createPersistence({
        loadDesktop: () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      }),
    );

    const update = store.update({ density: "compact" });
    resolveLoad({ density: "comfortable" });
    await Promise.all([store.initialize(), update]);

    expect(store.getSnapshot().density).toBe("compact");
  });


  it("merges updates with loaded settings before saving during startup", async () => {
    let resolveLoad: (value: unknown) => void = () => undefined;
    const saveDesktop = vi.fn(async () => undefined);
    const store = new AppPreferencesStore(
      createPersistence({
        loadDesktop: () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
        saveDesktop,
      }),
    );

    const update = store.update({ density: "compact" });
    resolveLoad({ appThemePreset: "light", bookCardSize: "large" });
    await update;

    expect(saveDesktop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appThemePreset: "light",
        bookCardSize: "large",
        density: "compact",
      }),
    );
  });

  it("persists reader, library, import, and file preferences at app level", async () => {
    const saveDesktop = vi.fn(async () => undefined);
    const store = new AppPreferencesStore(createPersistence({ saveDesktop }));
    await store.initialize();

    await store.update({
      filesAndMetadata: { liveWatcherEnabled: false, scanOnStartup: false },
      import: { defaultConflictAction: "skip", defaultMode: "move" },
      library: { sortBy: "recently-opened", viewMode: "list" },
      reader: {
        ...normalizeAppPreferences(null).reader,
        fontSize: 24,
        progressPlacement: "side",
      },
    });

    expect(saveDesktop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filesAndMetadata: {
          liveWatcherEnabled: false,
          scanOnStartup: false,
        },
        import: {
          defaultConflictAction: "skip",
          defaultMode: "move",
        },
        library: {
          sortBy: "recently-opened",
          viewMode: "list",
        },
        reader: expect.objectContaining({
          fontSize: 24,
          progressPlacement: "side",
        }),
      }),
    );
  });
});
