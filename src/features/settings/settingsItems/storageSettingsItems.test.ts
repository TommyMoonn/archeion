import { describe, expect, it } from "vitest";

import { getSettingsItemsForSection } from "../settingsItems";
import { storageSettingsItems } from "./storageSettingsItems";

describe("storage settings items", () => {
  it("keeps the final ownership groups and item order", () => {
    expect(storageSettingsItems.map(({ groupLabel, id }) => ({ groupLabel, id }))).toEqual([
      { groupLabel: "Global policies", id: "storage.scan-on-startup" },
      { groupLabel: "Global policies", id: "storage.live-filesystem-watcher" },
      {
        groupLabel: "Global policies",
        id: "storage.keep-epub-writeback-backup",
      },
      { groupLabel: "Global policies", id: "storage.reset" },
      { groupLabel: "Archive maintenance", id: "storage.rescan-archive" },
      { groupLabel: "Archive maintenance", id: "storage.scanner-cache" },
      { groupLabel: "Archive maintenance", id: "storage.reextract-source-metadata" },
      { groupLabel: "Archive maintenance", id: "storage.cover-cache-status" },
      {
        groupLabel: "Archive maintenance",
        id: "storage.clear-epub-writeback-backups",
      },
      { groupLabel: "Archive maintenance", id: "storage.repair-metadata" },
      { groupLabel: "Archive maintenance", id: "storage.metadata-folder" },
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
