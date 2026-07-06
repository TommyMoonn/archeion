import ePub from "epubjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseEpubMetadata,
  titleFromFileName,
} from "./parseEpubMetadata";

vi.mock("epubjs", () => ({
  default: vi.fn(),
}));

function createFile(name: string) {
  return new File(["epub-content"], name, {
    type: "application/epub+zip",
  });
}

describe("EPUB metadata parsing", () => {
  beforeEach(() => {
    vi.mocked(ePub).mockReset();
  });

  it("creates a readable fallback title from the filename", () => {
    expect(titleFromFileName("ascendance_of-a-bookworm.epub")).toBe(
      "ascendance of a bookworm",
    );
    expect(titleFromFileName(".epub")).toBe("Untitled");
  });

  it("cleans metadata and leaves missing author metadata unavailable", async () => {
    const destroy = vi.fn();

    vi.mocked(ePub).mockReturnValue({
      opened: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          title: "  A   Book  ",
          creator: " ",
        }),
      },
      coverUrl: vi.fn().mockResolvedValue(null),
      destroy,
    } as never);

    await expect(parseEpubMetadata(createFile("fallback.epub"))).resolves.toEqual(
      {
        title: "A Book",
        author: undefined,
      },
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("releases parser resources when metadata parsing fails", async () => {
    const destroy = vi.fn();

    vi.mocked(ePub).mockReturnValue({
      opened: Promise.resolve(),
      loaded: {
        metadata: Promise.reject(new Error("Malformed package document.")),
      },
      destroy,
    } as never);

    await expect(
      parseEpubMetadata(createFile("broken.epub")),
    ).rejects.toThrow("Malformed package document.");
    expect(destroy).toHaveBeenCalledOnce();
  });
});
