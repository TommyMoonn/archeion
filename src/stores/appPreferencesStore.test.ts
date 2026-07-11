// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { createDefaultLibraryFilters } from "../types/library";
import { AppPreferencesStore, normalizeAppPreferences } from "./appPreferencesStore";

function createPersistence(
  overrides: Partial<ConstructorParameters<typeof AppPreferencesStore>[0]> = {},
) {
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

function mockReducedMotion(matches: boolean) {
  const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(
      (query: string) =>
        ({
          matches: matches && query === "(prefers-reduced-motion: reduce)",
        }) as MediaQueryList,
    ),
  });

  return () => {
    if (original) {
      Object.defineProperty(window, "matchMedia", original);
      return;
    }

    Reflect.deleteProperty(window, "matchMedia");
  };
}

describe("app preferences", () => {
  it("uses defaults for missing and invalid values", () => {
    expect(normalizeAppPreferences(null)).toMatchObject({
      appThemePreset: "dark",
      appearance: {
        animationsEnabled: false,
      },
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
        keepEpubWritebackBackup: false,
        liveWatcherEnabled: true,
        scanOnStartup: true,
      },
    });
    expect(
      normalizeAppPreferences({
        appThemePreset: "custom",
        appearance: { animationsEnabled: "yes" },
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
      appearance: {
        animationsEnabled: false,
      },
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
        appearance: {
          animationsEnabled: true,
        },
        density: "compact",
        bookCardSize: "large",
        confirmDestructiveFileActions: false,
        filesAndMetadata: {
          keepEpubWritebackBackup: true,
          liveWatcherEnabled: false,
          scanOnStartup: false,
        },
        import: {
          defaultConflictAction: "replace",
          defaultMode: "move",
        },
        library: {
          filters: {
            series: [" Star Saga ", "star saga"],
            subjects: ["Space Opera"],
            languages: ["en"],
            publishers: ["North Press"],
            readingStatuses: ["UNREAD", "completed", "invalid"],
            favoritesOnly: true,
            missingMetadata: true,
            missingCover: false,
          },
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
          mode: "continuous",
        },
        rememberWindowState: true,
        restoreLastReader: true,
        showContinueReading: false,
        startupBehavior: "show-archive-manager",
        windowFrameStyle: "native",
      }),
    ).toEqual({
      appThemePreset: "light",
      appearance: {
        animationsEnabled: true,
      },
      density: "compact",
      bookCardSize: "large",
      confirmDestructiveFileActions: false,
      filesAndMetadata: {
        keepEpubWritebackBackup: true,
        liveWatcherEnabled: false,
        scanOnStartup: false,
      },
      import: {
        defaultConflictAction: "replace",
        defaultMode: "move",
      },
      library: {
        filters: {
          series: ["Star Saga"],
          subjects: ["Space Opera"],
          languages: ["en"],
          publishers: ["North Press"],
          readingStatuses: ["unread", "completed"],
          favoritesOnly: true,
          missingMetadata: true,
          missingCover: false,
        },
        viewMode: "list",
        sortBy: "author",
      },
      navigation: null,
      reader: {
        fontSize: 22,
        fontFamily: "sans",
        lineHeight: 1.8,
        margin: 64,
        theme: "sepia",
        progressPlacement: "side",
        mode: "continuous",
      },
      rememberWindowState: true,
      restoreLastReader: true,
      showContinueReading: false,
      startupBehavior: "show-archive-manager",
      window: null,
      windowFrameStyle: "native",
    });
  });

  it("preserves supported bundled reader fonts", () => {
    expect(
      normalizeAppPreferences({
        reader: {
          fontFamily: "literata",
        },
      }).reader.fontFamily,
    ).toBe("literata");
    expect(
      normalizeAppPreferences({
        reader: {
          fontFamily: "atkinson",
        },
      }).reader.fontFamily,
    ).toBe("atkinson");
  });

  it("normalizes remembered navigation and window geometry", () => {
    expect(
      normalizeAppPreferences({
        navigation: {
          archiveId: " archive-1 ",
          bookId: "book-1",
          lastRoute: "/reader/book-1",
        },
        window: {
          height: 700.4,
          maximized: true,
          width: 1000.6,
          x: -120.2,
          y: 40.7,
        },
      }),
    ).toMatchObject({
      navigation: {
        archiveId: "archive-1",
        bookId: "book-1",
        lastRoute: "/reader/book-1",
      },
      window: {
        height: 700,
        maximized: true,
        width: 1001,
        x: -120,
        y: 41,
      },
    });

    expect(
      normalizeAppPreferences({
        navigation: {
          archiveId: "archive-1",
          bookId: "book-1",
          lastRoute: "/reader/book-1?start=beginning",
        },
        window: { height: -1, width: 1000, x: 0, y: 0 },
      }),
    ).toMatchObject({ navigation: null, window: null });
  });

  it("normalizes unknown reader fonts to book serif", () => {
    expect(
      normalizeAppPreferences({
        reader: {
          fontFamily: "legacy-custom-font",
        },
      }).reader.fontFamily,
    ).toBe("serif");
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
    expect(saveDesktop).toHaveBeenCalledWith(expect.objectContaining({ density: "compact" }));
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

    await expect(store.update({ density: "compact" })).rejects.toThrow(/disk full/);
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

  it("preserves unrelated preference branch references after scoped updates", async () => {
    const store = new AppPreferencesStore(createPersistence());
    await store.initialize();
    const before = store.getSnapshot();

    await store.update({
      reader: {
        ...before.reader,
        fontSize: before.reader.fontSize + 1,
      },
    });

    const after = store.getSnapshot();
    expect(after.reader).not.toBe(before.reader);
    expect(after.appearance).toBe(before.appearance);
    expect(after.filesAndMetadata).toBe(before.filesAndMetadata);
    expect(after.import).toBe(before.import);
    expect(after.library).toBe(before.library);
  });

  it("clears saved geometry when window state memory is disabled", async () => {
    const store = new AppPreferencesStore(createPersistence());
    await store.initialize();
    await store.update({
      rememberWindowState: true,
      window: { height: 700, maximized: false, width: 1000, x: 10, y: 20 },
    });

    await store.update({ rememberWindowState: false });

    expect(store.getSnapshot().window).toBeNull();
  });

  it("persists reader, library, import, and file preferences at app level", async () => {
    const saveDesktop = vi.fn(async () => undefined);
    const store = new AppPreferencesStore(createPersistence({ saveDesktop }));
    await store.initialize();

    await store.update({
      appearance: { animationsEnabled: true },
      filesAndMetadata: {
        keepEpubWritebackBackup: true,
        liveWatcherEnabled: false,
        scanOnStartup: false,
      },
      import: { defaultConflictAction: "skip", defaultMode: "move" },
      library: {
        filters: createDefaultLibraryFilters(),
        sortBy: "recently-opened",
        viewMode: "list",
      },
      reader: {
        ...normalizeAppPreferences(null).reader,
        fontSize: 24,
        progressPlacement: "side",
      },
    });

    expect(saveDesktop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: {
          animationsEnabled: true,
        },
        filesAndMetadata: {
          keepEpubWritebackBackup: true,
          liveWatcherEnabled: false,
          scanOnStartup: false,
        },
        import: {
          defaultConflictAction: "skip",
          defaultMode: "move",
        },
        library: {
          filters: createDefaultLibraryFilters(),
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

  it("applies motion off when animations are disabled", async () => {
    const store = new AppPreferencesStore(createPersistence());
    await store.initialize();

    expect(document.documentElement.dataset.motion).toBe("off");
  });

  it("applies motion on only when animations are enabled and reduced motion is not requested", async () => {
    const restoreMatchMedia = mockReducedMotion(false);
    const store = new AppPreferencesStore(createPersistence());
    await store.initialize();

    await store.update({ appearance: { animationsEnabled: true } });

    expect(document.documentElement.dataset.motion).toBe("on");
    restoreMatchMedia();
  });

  it("keeps effective motion off when the OS requests reduced motion", async () => {
    const restoreMatchMedia = mockReducedMotion(true);
    const store = new AppPreferencesStore(createPersistence());
    await store.initialize();

    await store.update({ appearance: { animationsEnabled: true } });

    expect(document.documentElement.dataset.motion).toBe("off");
    restoreMatchMedia();
  });
});
