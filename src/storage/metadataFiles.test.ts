import { describe, expect, it } from "vitest";

import {
  createLibraryMetadata,
  createSettingsMetadata,
  normalizeSettingsMetadata,
} from "./metadataFiles";

describe("metadataFiles", () => {
  it("creates empty library metadata with the current schema version", () => {
    expect(createLibraryMetadata()).toEqual({
      version: 1,
      books: {},
    });
  });

  it("creates version 2 archive settings with inherited appearance", () => {
    expect(createSettingsMetadata()).toEqual({
      version: 2,
      import: {},
      appearance: {
        appTheme: { kind: "inherit" },
        readerTheme: { kind: "inherit" },
      },
    });
  });

  it("normalizes version 1 settings in memory without keeping old app-level fields", () => {
    expect(
      normalizeSettingsMetadata({
        version: 1,
        reader: {
          fontSize: 22,
          fontFamily: "serif",
          lineHeight: 1.8,
          margin: 64,
          theme: "sepia",
        },
        library: {
          viewMode: "list",
          sortBy: "recently-opened",
        },
        filesAndMetadata: {
          scanOnStartup: false,
          liveWatcherEnabled: false,
        },
        import: {
          defaultConflictAction: "replace",
          defaultDestinationFolderPath: "Fiction\\Classics",
          defaultMode: "move",
        },
      }),
    ).toEqual({
      version: 2,
      import: {
        defaultDestinationFolderPath: "Fiction/Classics",
      },
      appearance: {
        appTheme: { kind: "inherit" },
        readerTheme: { kind: "inherit" },
      },
    });
  });

  it("normalizes version 2 appearance selections while preserving custom references", () => {
    expect(
      normalizeSettingsMetadata({
        version: 2,
        import: { defaultDestinationFolderPath: " Themes\\Incoming " },
        appearance: {
          appTheme: { kind: "custom", id: "missing-theme" },
          readerTheme: { kind: "builtin", id: "sepia" },
        },
      }),
    ).toEqual({
      version: 2,
      import: { defaultDestinationFolderPath: "Themes/Incoming" },
      appearance: {
        appTheme: { kind: "custom", id: "missing-theme" },
        readerTheme: { kind: "builtin", id: "sepia" },
      },
    });
  });

  it("falls back malformed selections independently without exposing unsupported kinds", () => {
    expect(
      normalizeSettingsMetadata({
        version: 2,
        appearance: {
          appTheme: { kind: "builtin", id: "sepia" },
          readerTheme: { kind: "system" },
        },
      }),
    ).toEqual({
      version: 2,
      import: {},
      appearance: {
        appTheme: { kind: "inherit" },
        readerTheme: { kind: "inherit" },
      },
    });
  });
});
