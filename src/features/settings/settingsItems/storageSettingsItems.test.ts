import { describe, expect, it } from "vitest";

import { getSettingsItemsForSection } from "../settingsItems";
import { storageSettingsItems } from "./storageSettingsItems";

describe("storage settings items", () => {
  it("keeps the final ownership groups and item order", () => {
    expect(storageSettingsItems.map(({ groupLabel, id }) => ({ groupLabel, id }))).toEqual([
      { groupLabel: "File monitoring", id: "storage.scan-on-startup" },
      { groupLabel: "File monitoring", id: "storage.live-filesystem-watcher" },
      { groupLabel: "Archive scanning", id: "storage.rescan-archive" },
      { groupLabel: "Archive scanning", id: "storage.scanner-cache" },
      { groupLabel: "Archive scanning", id: "storage.reextract-source-metadata" },
      { groupLabel: "Generated cover cache", id: "storage.cover-cache-status" },
      {
        groupLabel: "EPUB writeback backups",
        id: "storage.keep-epub-writeback-backup",
      },
      {
        groupLabel: "EPUB writeback backups",
        id: "storage.clear-epub-writeback-backups",
      },
      { groupLabel: "Archive metadata and recovery", id: "storage.repair-metadata" },
      { groupLabel: "Archive metadata and recovery", id: "storage.metadata-folder" },
      { groupLabel: "Reset", id: "storage.reset" },
    ]);
    expect(getSettingsItemsForSection("storage")).toEqual(storageSettingsItems);
  });

  it("keeps deferred status ownership on only the rows that display it", () => {
    expect(
      storageSettingsItems
        .filter((item) => "deferredData" in item)
        .map(({ deferredData, id }) => ({ deferredData, id })),
    ).toEqual([
      { deferredData: ["coverCacheStatus"], id: "storage.cover-cache-status" },
      {
        deferredData: ["epubWritebackBackupStatus"],
        id: "storage.clear-epub-writeback-backups",
      },
    ]);
  });
});
