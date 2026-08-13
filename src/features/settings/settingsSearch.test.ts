import { describe, expect, it } from "vitest";

import { findSettingsSearchResults } from "./settingsSearch";

describe("settingsSearch", () => {
  it("finds current labels and group terms", () => {
    expect(findSettingsSearchResults("display density").map((result) => result.item.id)).toContain(
      "appearance.display-density",
    );
    expect(findSettingsSearchResults("animations").map((result) => result.item.id)).toContain(
      "appearance.animations",
    );
    expect(findSettingsSearchResults("file monitoring").map((result) => result.item.id)).toContain(
      "storage.scan-on-startup",
    );
    expect(findSettingsSearchResults("archive scanning").map((result) => result.item.id)).toContain(
      "storage.rescan-archive",
    );
    expect(
      findSettingsSearchResults("generated cover cache").map((result) => result.item.id),
    ).toContain("storage.cover-cache-status");
    expect(findSettingsSearchResults("sidecar metadata").map((result) => result.item.id)).toContain(
      "storage.repair-metadata",
    );
    expect(findSettingsSearchResults("writeback backup").map((result) => result.item.id)).toContain(
      "storage.keep-epub-writeback-backup",
    );
    expect(findSettingsSearchResults("archive maintenance")).toHaveLength(0);
  });

  it("supports useful row-level searches", () => {
    expect(findSettingsSearchResults("scan startup").map((result) => result.item.id)).toEqual([
      "storage.scan-on-startup",
    ]);
  });

  it("returns only the final app and reader theme controls", () => {
    expect(findSettingsSearchResults("theme").map((result) => result.item.id)).toEqual([
      "reader.theme",
      "appearance.app-themes",
    ]);
  });

  it("finds the Smart Views master and every built-in view", () => {
    expect(findSettingsSearchResults("smart views").map((result) => result.item.id)).toContain(
      "library.smart-views.enabled",
    );
    expect(findSettingsSearchResults("not started").map((result) => result.item.id)).toEqual([
      "library.smart-views.unread",
    ]);
    expect(findSettingsSearchResults("continue reading").map((result) => result.item.id)).toContain(
      "library.smart-views.in-progress",
    );
    expect(findSettingsSearchResults("finished").map((result) => result.item.id)).toEqual([
      "library.smart-views.completed",
    ]);
    expect(findSettingsSearchResults("missing author").map((result) => result.item.id)).toEqual([
      "library.smart-views.needs-metadata",
    ]);
    expect(findSettingsSearchResults("cover art").map((result) => result.item.id)).toEqual([
      "library.smart-views.needs-cover",
    ]);
    expect(findSettingsSearchResults("duplicate books").map((result) => result.item.id)).toEqual([
      "library.smart-views.duplicates",
    ]);
    expect(findSettingsSearchResults("epub diagnostics").map((result) => result.item.id)).toEqual([
      "library.smart-views.epub-issues",
    ]);
  });

  it("finds collection display settings by domain-specific terms", () => {
    expect(findSettingsSearchResults("folder path").map((result) => result.item.id)).toContain(
      "library.folders.default-sort",
    );
    expect(findSettingsSearchResults("book count").map((result) => result.item.id)).toContain(
      "library.folders.default-sort",
    );
    expect(
      findSettingsSearchResults("recently opened series").map((result) => result.item.id),
    ).toContain("library.series.default-sort");
    expect(findSettingsSearchResults("volume count").map((result) => result.item.id)).toContain(
      "library.series.default-sort",
    );
    expect(findSettingsSearchResults("card size").map((result) => result.item.id)).toEqual(
      expect.arrayContaining([
        "library.books.card-size",
        "library.folders.card-size",
        "library.series.card-size",
      ]),
    );
  });

  it("keeps removed composite labels out of search", () => {
    expect(findSettingsSearchResults("appearance and window")).toHaveLength(0);
    expect(findSettingsSearchResults("files and maintenance")).toHaveLength(0);
    expect(findSettingsSearchResults("interface")).toHaveLength(0);
  });
});
