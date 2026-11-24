import { describe, expect, it } from "vitest";

import { getSettingsItemsForSection } from "../settingsItems";

describe("storage settings items", () => {
  it("keeps deferred status ownership on only the rows that display it", () => {
    expect(
      getSettingsItemsForSection("storage")
        .filter((item) => item.deferredData?.length)
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
