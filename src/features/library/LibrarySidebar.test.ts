import { describe, expect, it } from "vitest";

import { archiveName } from "./archiveName";

describe("archive sidebar identity", () => {
  it("uses the final folder name for Windows and Unix paths", () => {
    expect(archiveName("C:\\Books\\Archeion")).toBe("Archeion");
    expect(archiveName("/home/reader/library/")).toBe("library");
  });

  it("falls back when no archive path is available", () => {
    expect(archiveName("")).toBe("Archive");
  });
});
