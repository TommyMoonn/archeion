import { describe, expect, it } from "vitest";

import { ARCHIVE_ROOT_DESTINATION } from "./archiveImport";
import {
  importDragAutoScrollDelta,
  importDropTargetAttributes,
  validateExternalEpubDrop,
} from "./externalEpubDrop";

describe("external EPUB drop validation", () => {
  it("accepts one or more EPUB paths case-insensitively", () => {
    expect(validateExternalEpubDrop(["D:\\Incoming\\One.epub", "D:\\Two.EPUB"])).toEqual({
      valid: true,
      sourcePaths: ["D:\\Incoming\\One.epub", "D:\\Two.EPUB"],
    });
  });

  it("rejects mixed file types instead of silently importing a subset", () => {
    expect(validateExternalEpubDrop(["D:\\One.epub", "D:\\notes.pdf"])).toEqual({
      valid: false,
      message: "Only EPUB files can be dropped. Folders are not supported.",
    });
  });

  it("maps an omitted folder to the archive root target", () => {
    expect(importDropTargetAttributes()).toEqual({
      "data-import-drop-target": "true",
      "data-import-drop-destination": ARCHIVE_ROOT_DESTINATION,
      "data-import-drop-id": "archive-root",
    });
  });

  it("auto-scrolls only near a valid scroll surface edge", () => {
    expect(importDragAutoScrollDelta(110, 100, 500)).toBe(-18);
    expect(importDragAutoScrollDelta(490, 100, 500)).toBe(18);
    expect(importDragAutoScrollDelta(300, 100, 500)).toBe(0);
    expect(importDragAutoScrollDelta(80, 100, 500)).toBe(0);
  });
});
