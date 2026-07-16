// @vitest-environment happy-dom

import type { Book as EpubBook } from "epubjs";
import { describe, expect, it, vi } from "vitest";

import {
  EPUB_ILLUSTRATION_MAX_BYTES,
  EPUB_ILLUSTRATION_MAX_DIMENSION,
  illustrationTargetForElement,
  resolveEpubIllustration,
  type EpubIllustrationResolverDependencies,
} from "./epubIllustrationResolver";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function book(
  overrides: Readonly<{
    blob?: Blob;
    href?: string;
    mediaType?: string;
    replacementUrl?: string;
  }> = {},
) {
  const href = overrides.href ?? "Images/plate.jpg";
  const blob = overrides.blob ?? new Blob(["illustration"], { type: "image/jpeg" });
  const getBlob = vi.fn(async () => blob);
  return {
    archive: { getBlob },
    packaging: {
      manifest: {
        plate: { href, properties: [], type: overrides.mediaType ?? "image/jpeg" },
      },
    },
    resolve: vi.fn((path: string) => `/OPS/${path}`),
    resources: {
      replacementUrls: overrides.replacementUrl ? [overrides.replacementUrl] : [],
      urls: overrides.replacementUrl ? [href] : [],
    },
  } as unknown as EpubBook & { archive: { getBlob: typeof getBlob } };
}

function target(href = "Images/plate.jpg") {
  return { displayTarget: href, documentHref: href, resourceKind: "illustration" as const };
}

function dependencies(
  dimensions: Readonly<{ height: number; width: number }> = { height: 1200, width: 1600 },
) {
  return {
    createObjectUrl: vi.fn(() => "blob:illustration"),
    decodeDimensions: vi.fn(async () => dimensions),
    revokeObjectUrl: vi.fn(),
  } satisfies EpubIllustrationResolverDependencies;
}

describe("epubIllustrationResolver", () => {
  it("resolves a manifest-owned local image with media type, dimensions, and bounded URL life", async () => {
    const activeBook = book();
    const owner = dependencies();

    const resolution = await resolveEpubIllustration(activeBook, target(), undefined, owner);

    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(activeBook.archive.getBlob).toHaveBeenCalledWith("/OPS/Images/plate.jpg", "image/jpeg");
    expect(resolution.value).toMatchObject({
      height: 1200,
      href: "Images/plate.jpg",
      mediaType: "image/jpeg",
      url: "blob:illustration",
      width: 1600,
    });
    expect(owner.createObjectUrl).toHaveBeenCalledWith(resolution.value.blob);
    resolution.value.release();
    resolution.value.release();
    expect(owner.revokeObjectUrl).toHaveBeenCalledOnce();
  });

  it("derives img and SVG image references relative to the active content document", () => {
    const activeBook = book();
    const image = document.createElement("img");
    image.src = "../Images/plate.jpg";
    const svgImage = document.createElementNS("http://www.w3.org/2000/svg", "image");
    svgImage.setAttribute("href", "../Images/plate.jpg");

    expect(illustrationTargetForElement(activeBook, image, "Text/chapter.xhtml")).toMatchObject({
      documentHref: "Images/plate.jpg",
      resourceKind: "illustration",
    });
    expect(illustrationTargetForElement(activeBook, svgImage, "Text/chapter.xhtml")).toMatchObject({
      documentHref: "Images/plate.jpg",
      resourceKind: "illustration",
    });
  });

  it.each([
    "\nImages/plate.jpg",
    "Images/plate.jpg\t",
    "\rImages/plate.jpg",
    "Images/\u007fplate.jpg",
  ])("rejects raw control characters before normalizing illustration source %j", (source) => {
    const activeBook = book();
    const image = document.createElement("img");
    image.setAttribute("src", source);
    const svgHref = document.createElementNS("http://www.w3.org/2000/svg", "image");
    svgHref.setAttribute("href", source);
    const svgXlink = document.createElementNS("http://www.w3.org/2000/svg", "image");
    svgXlink.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", source);

    expect(illustrationTargetForElement(activeBook, image, "Text/chapter.xhtml")).toBeNull();
    expect(illustrationTargetForElement(activeBook, svgHref, "Text/chapter.xhtml")).toBeNull();
    expect(illustrationTargetForElement(activeBook, svgXlink, "Text/chapter.xhtml")).toBeNull();
    expect(activeBook.archive.getBlob).not.toHaveBeenCalled();
  });

  it("maps an EPUB.js replacement URL back to its manifest-owned resource", () => {
    const activeBook = book({ replacementUrl: "blob:epubjs-replacement" });
    const image = document.createElement("img");
    image.src = "blob:epubjs-replacement";

    expect(illustrationTargetForElement(activeBook, image, "Text/chapter.xhtml")).toEqual({
      displayTarget: "Images/plate.jpg",
      documentHref: "Images/plate.jpg",
      resourceKind: "illustration",
    });
  });

  it("rejects remote, traversal, scriptable, missing, and oversized sources", async () => {
    const image = document.createElement("img");
    image.src = "https://example.com/plate.jpg";
    expect(illustrationTargetForElement(book(), image, "Text/chapter.xhtml")).toBeNull();
    image.src = "../../../plate.jpg";
    expect(illustrationTargetForElement(book(), image, "Text/chapter.xhtml")).toBeNull();

    await expect(
      resolveEpubIllustration(
        book({ mediaType: "image/svg+xml" }),
        target(),
        undefined,
        dependencies(),
      ),
    ).resolves.toEqual({ kind: "unsupported", reason: "type" });
    await expect(
      resolveEpubIllustration(
        book({ href: "Images/other.jpg" }),
        target(),
        undefined,
        dependencies(),
      ),
    ).resolves.toEqual({ kind: "unsupported", reason: "missing" });
    await expect(
      resolveEpubIllustration(
        book({ href: "Images/../plate.jpg" }),
        target("plate.jpg"),
        undefined,
        dependencies(),
      ),
    ).resolves.toEqual({ kind: "unsupported", reason: "source" });
    await expect(
      resolveEpubIllustration(
        book({ blob: new Blob([new Uint8Array(EPUB_ILLUSTRATION_MAX_BYTES + 1)]) }),
        target(),
        undefined,
        dependencies(),
      ),
    ).resolves.toEqual({ kind: "unsupported", reason: "size" });
  });

  it("rejects decoded dimensions beyond the dimension and pixel bounds and revokes immediately", async () => {
    for (const dimensions of [
      { height: 1, width: EPUB_ILLUSTRATION_MAX_DIMENSION + 1 },
      { height: 7000, width: 7000 },
      { height: 0, width: 100 },
    ]) {
      const owner = dependencies(dimensions);
      await expect(resolveEpubIllustration(book(), target(), undefined, owner)).resolves.toEqual({
        kind: "unsupported",
        reason: "dimensions",
      });
      expect(owner.revokeObjectUrl).toHaveBeenCalledOnce();
    }
  });

  it("cancels pending loads and decoding without leaking an object URL", async () => {
    const blobLoad = deferred<Blob>();
    const activeBook = book();
    activeBook.archive.getBlob.mockImplementationOnce(() => blobLoad.promise);
    const beforeUrl = dependencies();
    const firstAbort = new AbortController();
    const first = resolveEpubIllustration(activeBook, target(), firstAbort.signal, beforeUrl);
    firstAbort.abort();
    blobLoad.resolve(new Blob(["image"]));
    await expect(first).resolves.toEqual({ kind: "cancelled" });
    expect(beforeUrl.createObjectUrl).not.toHaveBeenCalled();

    const dimensions = deferred<{ height: number; width: number }>();
    const duringDecode = dependencies();
    duringDecode.decodeDimensions.mockImplementationOnce(() => dimensions.promise);
    const secondAbort = new AbortController();
    const second = resolveEpubIllustration(book(), target(), secondAbort.signal, duringDecode);
    await Promise.resolve();
    secondAbort.abort();
    dimensions.resolve({ height: 100, width: 100 });
    await expect(second).resolves.toEqual({ kind: "cancelled" });
    expect(duringDecode.revokeObjectUrl).toHaveBeenCalledOnce();
  });
});
