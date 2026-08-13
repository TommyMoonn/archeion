// @vitest-environment happy-dom

import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { createDefaultLibraryFilters } from "../types/library";
import {
  appPreferencesStore,
  AppPreferencesStore,
  normalizeAppPreferences,
  useConfirmDestructiveFileActionsPreference,
} from "./appPreferencesStore";

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
  it("loads preferences only when the window startup owner initializes it", async () => {
    const loadDesktop = vi.fn(async () => ({ density: "compact" }));
    const store = new AppPreferencesStore(createPersistence({ loadDesktop }));

    expect(loadDesktop).not.toHaveBeenCalled();

    await Promise.all([store.initialize(), store.initialize()]);

    expect(loadDesktop).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().density).toBe("compact");
  });

  it("loads malformed persisted shortcuts without rejecting valid preference siblings", async () => {
    const store = new AppPreferencesStore(
      createPersistence({
        loadDesktop: async () => ({
          appearance: { animationsEnabled: true },
          density: "compact",
          keyboard: {
            shortcuts: {
              "system.open-settings": {
                binding: { key: "k", primary: true, shift: true },
              },
              "surface.focus-search": {
                binding: { alt: true, key: "g", primary: true },
              },
              "reader.open-annotations": {
                binding: { key: "q" },
              },
              "reader.open-reading-settings": {
                disabled: true,
              },
              "system.quick-actions": {
                binding: { key: "k", primary: true, shift: true },
              },
            },
          },
        }),
      }),
    );

    await expect(store.initialize()).resolves.toBeUndefined();

    expect(store.getPersistenceSnapshot()).toEqual({ status: "idle" });
    expect(store.getSnapshot()).toMatchObject({
      appearance: { animationsEnabled: true },
      density: "compact",
      keyboard: {
        shortcuts: {
          "system.quick-actions": {
            binding: {
              alt: false,
              key: "k",
              primary: true,
              shift: true,
            },
          },
          "reader.open-annotations": {
            binding: {
              alt: false,
              key: "q",
              primary: false,
              shift: false,
            },
          },
          "reader.open-reading-settings": {
            disabled: true,
          },
        },
      },
    });
    expect(store.getSnapshot().keyboard.shortcuts).not.toHaveProperty("system.open-settings");
    expect(store.getSnapshot().keyboard.shortcuts).not.toHaveProperty("surface.focus-search");
  });

  it("preserves valid effective keyboard states through an unrelated preference update", async () => {
    const saveDesktop = vi.fn(async () => undefined);
    const store = new AppPreferencesStore(
      createPersistence({
        loadDesktop: async () => ({
          keyboard: {
            shortcuts: {
              "surface.focus-search": {
                binding: { key: "g", primary: true },
              },
              "system.quick-actions": {
                binding: { key: "f", primary: true },
              },
            },
          },
        }),
        saveDesktop,
      }),
    );

    await store.initialize();

    const expectedKeyboard = {
      shortcuts: {
        "system.quick-actions": {
          binding: {
            alt: false,
            key: "f",
            primary: true,
            shift: false,
          },
        },
        "surface.focus-search": {
          binding: {
            alt: false,
            key: "g",
            primary: true,
            shift: false,
          },
        },
      },
    };
    expect(store.getSnapshot().keyboard).toEqual(expectedKeyboard);

    await store.update({ density: "compact" });

    expect(store.getSnapshot().keyboard).toEqual(expectedKeyboard);
    expect(saveDesktop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        density: "compact",
        keyboard: expectedKeyboard,
      }),
    );
  });

  it("reloads customized and cleared sidebar shortcuts from persisted preferences", async () => {
    let persisted: unknown = {};
    const persistence = createPersistence({
      loadDesktop: async () => persisted,
      saveDesktop: vi.fn(async (preferences) => {
        persisted = preferences;
      }),
    });
    const customized = new AppPreferencesStore(persistence);
    await customized.initialize();
    await customized.update({
      keyboard: {
        shortcuts: {
          "library.toggle-sidebar": {
            binding: { alt: false, key: "g", primary: true, shift: true },
          },
        },
      },
    });

    const afterCustomization = new AppPreferencesStore(persistence);
    await afterCustomization.initialize();
    expect(afterCustomization.getSnapshot().keyboard.shortcuts).toEqual({
      "library.toggle-sidebar": {
        binding: { alt: false, key: "g", primary: true, shift: true },
      },
    });

    await afterCustomization.update({
      keyboard: { shortcuts: { "library.toggle-sidebar": { disabled: true } } },
    });
    const afterClear = new AppPreferencesStore(persistence);
    await afterClear.initialize();
    expect(afterClear.getSnapshot().keyboard.shortcuts).toEqual({
      "library.toggle-sidebar": { disabled: true },
    });
  });

  it("does not rerender a narrow preference consumer for unrelated UI changes", async () => {
    const original = appPreferencesStore.getSnapshot();
    const container = document.createElement("div");
    const root = createRoot(container);
    let renders = 0;

    function PreferenceConsumer() {
      const renderCount = useRef(0);
      renderCount.current += 1;
      renders = renderCount.current;
      return String(useConfirmDestructiveFileActionsPreference());
    }

    try {
      await act(async () => {
        root.render(createElement(PreferenceConsumer));
      });
      expect(renders).toBe(1);

      await act(async () => {
        await appPreferencesStore.update({
          density: original.density === "compact" ? "comfortable" : "compact",
        });
      });
      expect(renders).toBe(1);

      await act(async () => {
        await appPreferencesStore.update({
          confirmDestructiveFileActions: !original.confirmDestructiveFileActions,
        });
      });
      expect(renders).toBe(2);
    } finally {
      await act(async () => {
        root.unmount();
        await appPreferencesStore.update(original);
      });
    }
  });

  it("uses defaults for missing and invalid values", () => {
    expect(normalizeAppPreferences(null)).toMatchObject({
      appThemePreset: "dark",
      appearance: {
        animationsEnabled: false,
      },
      density: "comfortable",
      showContinueReading: true,
      startupBehavior: "open-last-archive",
      library: {
        collections: {
          books: { cardSize: "medium", sortBy: "title", viewMode: "grid" },
          folders: { cardSize: "medium", sortBy: "name", viewMode: "list" },
          series: { cardSize: "medium", sortBy: "title", viewMode: "grid" },
        },
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
      startupBehavior: "open-last-archive",
      library: {
        collections: {
          books: { cardSize: "medium", sortBy: "title", viewMode: "grid" },
          folders: { cardSize: "medium", sortBy: "name", viewMode: "list" },
          series: { cardSize: "medium", sortBy: "title", viewMode: "grid" },
        },
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
      keyboard: {
        shortcuts: {},
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
        smartViews: {
          enabled: false,
          visible: ["unread", "in-progress", "completed", "needs-metadata", "needs-cover"],
        },
        collections: {
          books: { cardSize: "large", sortBy: "author", viewMode: "list" },
          folders: { cardSize: "medium", sortBy: "name", viewMode: "list" },
          series: { cardSize: "medium", sortBy: "title", viewMode: "grid" },
        },
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
    });
  });

  it("ignores a legacy frame style and omits it from the next save", async () => {
    const saveDesktop = vi.fn(async (preferences: unknown) => {
      void preferences;
    });
    const store = new AppPreferencesStore(
      createPersistence({
        loadDesktop: async () => ({
          density: "compact",
          showContinueReading: false,
          windowFrameStyle: "native",
        }),
        saveDesktop,
      }),
    );

    await store.initialize();

    expect(store.getSnapshot()).toMatchObject({
      density: "compact",
      showContinueReading: false,
    });
    expect(store.getSnapshot()).not.toHaveProperty("windowFrameStyle");

    await store.update({ restoreLastReader: true });

    expect(saveDesktop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        density: "compact",
        restoreLastReader: true,
        showContinueReading: false,
      }),
    );
    expect(saveDesktop.mock.lastCall?.[0]).not.toHaveProperty("windowFrameStyle");
  });

  it("normalizes invalid collection fields without discarding valid siblings", () => {
    const normalized = normalizeAppPreferences({
      bookCardSize: "large",
      library: {
        sortBy: "author",
        viewMode: "list",
        collections: {
          books: { cardSize: "invalid", sortBy: "recently-opened", viewMode: "invalid" },
          folders: { cardSize: "small", sortBy: "invalid", viewMode: "cards" },
          series: { cardSize: "large", sortBy: "most-volumes", viewMode: "invalid" },
        },
      },
    });

    expect(normalized.library.collections).toEqual({
      books: { cardSize: "large", sortBy: "recently-opened", viewMode: "list" },
      folders: { cardSize: "small", sortBy: "name", viewMode: "cards" },
      series: { cardSize: "large", sortBy: "most-volumes", viewMode: "grid" },
    });
    expect(normalized).not.toHaveProperty("bookCardSize");
    expect(normalized.library).not.toHaveProperty("sortBy");
    expect(normalized.library).not.toHaveProperty("viewMode");
  });

  it("round-trips the new collection schema through browser fallback persistence", async () => {
    let saved: unknown = null;
    const persistence = createPersistence({
      isDesktop: () => false,
      readLegacy: () => saved,
      saveBrowserFallback: vi.fn((preferences) => {
        saved = structuredClone(preferences);
      }),
    });
    const first = new AppPreferencesStore(persistence);
    await first.initialize();
    await first.updateLibraryCollection("folders", {
      cardSize: "small",
      sortBy: "most-books",
      viewMode: "cards",
    });
    await first.updateLibraryCollection("series", {
      cardSize: "large",
      sortBy: "recently-opened",
      viewMode: "list",
    });

    const second = new AppPreferencesStore(persistence);
    await second.initialize();

    expect(second.getSnapshot().library.collections).toMatchObject({
      folders: { cardSize: "small", sortBy: "most-books", viewMode: "cards" },
      series: { cardSize: "large", sortBy: "recently-opened", viewMode: "list" },
    });
    expect(saved).not.toHaveProperty("bookCardSize");
  });

  it("normalizes Smart View visibility to known canonical values", () => {
    expect(normalizeAppPreferences(null).library.smartViews).toEqual({
      enabled: false,
      visible: ["unread", "in-progress", "completed", "needs-metadata", "needs-cover"],
    });
    expect(
      normalizeAppPreferences({
        library: {
          smartViews: {
            enabled: true,
            visible: ["needs-cover", "unread", "needs-cover", "unknown", "completed"],
          },
        },
      }).library.smartViews,
    ).toEqual({ enabled: true, visible: ["unread", "completed", "needs-cover"] });
    expect(
      normalizeAppPreferences({
        library: { smartViews: { enabled: true, visible: [] } },
      }).library.smartViews,
    ).toEqual({
      enabled: true,
      visible: ["unread", "in-progress", "completed", "needs-metadata", "needs-cover"],
    });
    expect(
      normalizeAppPreferences({
        library: { smartViews: { enabled: false, visible: ["completed"] } },
      }).library.smartViews,
    ).toEqual({ enabled: false, visible: ["completed"] });
    expect(
      normalizeAppPreferences({
        library: {
          smartViews: {
            enabled: true,
            visible: ["epub-issues", "unread", "duplicates"],
          },
        },
      }).library.smartViews,
    ).toEqual({ enabled: true, visible: ["unread", "duplicates", "epub-issues"] });
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
      library: { collections: { books: { cardSize: "large" } } },
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

    await expect(store.update({ density: "compact" })).rejects.toThrow(
      "App settings could not be saved. Your changes remain active until Archeion closes. Try changing the setting again.",
    );
    expect(store.getPersistenceSnapshot()).toEqual({
      status: "error",
      error:
        "App settings could not be saved. Your changes remain active until Archeion closes. Try changing the setting again.",
    });
    expect(store.getSnapshot().density).toBe("compact");
  });

  it("keeps app settings load failures specific without exposing internal details", async () => {
    const store = new AppPreferencesStore(
      createPersistence({
        loadDesktop: vi.fn(async () => {
          throw new Error("Access denied at C:\\Users\\Private\\app-settings.json");
        }),
      }),
    );

    await expect(store.initialize()).rejects.toThrow(
      "App settings could not be loaded. Restart Archeion to try again.",
    );
    expect(store.getPersistenceSnapshot()).toEqual({
      status: "error",
      error: "App settings could not be loaded. Restart Archeion to try again.",
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
        density: "compact",
        library: expect.objectContaining({
          collections: expect.objectContaining({
            books: expect.objectContaining({ cardSize: "large" }),
          }),
        }),
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
        ...normalizeAppPreferences(null).library,
        collections: {
          ...normalizeAppPreferences(null).library.collections,
          books: {
            ...normalizeAppPreferences(null).library.collections.books,
            sortBy: "recently-opened",
            viewMode: "list",
          },
        },
        filters: createDefaultLibraryFilters(),
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
          collections: {
            ...normalizeAppPreferences(null).library.collections,
            books: {
              ...normalizeAppPreferences(null).library.collections.books,
              sortBy: "recently-opened",
              viewMode: "list",
            },
          },
          filters: createDefaultLibraryFilters(),
          smartViews: normalizeAppPreferences(null).library.smartViews,
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

  it("leaves application theme DOM ownership to the appearance runtime", async () => {
    const previousTheme = document.documentElement.dataset.appTheme;
    document.documentElement.dataset.appTheme = "runtime-owned";
    try {
      const store = new AppPreferencesStore(createPersistence());
      await store.initialize();
      await store.update({ appThemePreset: "light" });

      expect(document.documentElement.dataset.appTheme).toBe("runtime-owned");
    } finally {
      if (previousTheme === undefined) {
        delete document.documentElement.dataset.appTheme;
      } else {
        document.documentElement.dataset.appTheme = previousTheme;
      }
    }
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

describe("app preference write coalescing", () => {
  it("persists rapid desktop updates as one trailing latest-value write", async () => {
    vi.useFakeTimers();
    const saveDesktop = vi.fn(async () => undefined);
    const store = new AppPreferencesStore(createPersistence({ saveDesktop }));

    try {
      await store.initialize();
      const first = store.update({ density: "compact" });
      const second = store.updateLibraryCollection("books", { cardSize: "large" });

      expect(saveDesktop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      await expect(Promise.all([first, second])).resolves.toHaveLength(2);

      expect(saveDesktop).toHaveBeenCalledOnce();
      expect(saveDesktop).toHaveBeenCalledWith(
        expect.objectContaining({
          density: "compact",
          library: expect.objectContaining({
            collections: expect.objectContaining({
              books: expect.objectContaining({ cardSize: "large" }),
            }),
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes a pending desktop update without waiting for the trailing delay", async () => {
    vi.useFakeTimers();
    const saveDesktop = vi.fn(async () => undefined);
    const store = new AppPreferencesStore(createPersistence({ saveDesktop }));

    try {
      await store.initialize();
      const pending = store.update({ density: "compact" });
      await vi.advanceTimersByTimeAsync(0);
      await store.flushPendingWrites();
      await expect(pending).resolves.toMatchObject({ density: "compact" });
      expect(saveDesktop).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
