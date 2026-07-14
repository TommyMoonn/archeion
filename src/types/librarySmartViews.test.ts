import { describe, expect, it } from "vitest";

import {
  LIBRARY_SMART_VIEWS,
  normalizeVisibleLibraryHref,
  visibleLibrarySmartViewDefinitions,
} from "./librarySmartViews";

describe("library Smart View definitions", () => {
  it("keeps selected views in canonical order", () => {
    expect(
      visibleLibrarySmartViewDefinitions({
        enabled: true,
        visible: ["needs-cover", "unread", "completed"],
      }).map(({ id }) => id),
    ).toEqual(["unread", "completed", "needs-cover"]);
    expect(LIBRARY_SMART_VIEWS).toEqual([
      "unread",
      "in-progress",
      "completed",
      "needs-metadata",
      "needs-cover",
    ]);
  });

  it("sanitizes hidden return destinations while preserving safe search state", () => {
    expect(
      normalizeVisibleLibraryHref(
        "/?archiveId=books&view=smart&smartView=completed&query=space%20opera",
        { enabled: true, visible: ["unread"] },
      ),
    ).toBe("/?archiveId=books&view=library&query=space+opera");
  });

  it("leaves visible Smart View return destinations unchanged", () => {
    const href = "/?archiveId=books&view=smart&smartView=unread&query=space";
    expect(normalizeVisibleLibraryHref(href, { enabled: true, visible: ["unread"] })).toBe(href);
  });
});
