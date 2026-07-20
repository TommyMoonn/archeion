import { describe, expect, it } from "vitest";

import { getSettingsItemsForSection } from "../settingsItems";

describe("Library collection settings items", () => {
  const items = getSettingsItemsForSection("library");

  it("groups explicit Books, Folders, and Series display preferences in order", () => {
    expect(
      items
        .filter((item) => item.id.includes("default-") || item.id.endsWith("card-size"))
        .map((item) => [item.id, item.groupLabel]),
    ).toEqual([
      ["library.books.default-view", "Books"],
      ["library.books.default-sort", "Books"],
      ["library.books.card-size", "Books"],
      ["library.folders.default-view", "Folders"],
      ["library.folders.default-sort", "Folders"],
      ["library.folders.card-size", "Folders"],
      ["library.series.default-view", "Series"],
      ["library.series.default-sort", "Series"],
      ["library.series.card-size", "Series"],
    ]);
  });

  it("keeps the library reset after all collection and Smart View settings", () => {
    expect(items.at(-1)?.id).toBe("library.reset");
  });
});
