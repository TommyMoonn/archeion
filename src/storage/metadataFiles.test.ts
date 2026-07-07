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

  it("keeps archive settings scoped to import destination only", () => {
    expect(createSettingsMetadata()).toEqual({
      version: 1,
      import: {},
    });
  });

  it("normalizes legacy archive settings without keeping app-level fields", () => {
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
      version: 1,
      import: {
        defaultDestinationFolderPath: "Fiction/Classics",
      },
    });
  });
});
