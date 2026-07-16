import { describe, expect, it } from "vitest";

import {
  EPUB_ILLUSTRATION_IMAGE_CONTRACT,
  EPUB_ILLUSTRATION_IMAGE_TYPES,
  EPUB_ILLUSTRATION_MAX_BYTES,
  epubIllustrationExportFileName,
  epubIllustrationFileExtension,
  epubIllustrationImageType,
} from "./epubIllustrationImage";

describe("EPUB illustration image contract", () => {
  it("has a valid, non-conflicting shared mapping", () => {
    const mediaTypes = EPUB_ILLUSTRATION_IMAGE_TYPES.map(({ mediaType }) => mediaType);
    const extensionOwners = new Map<string, string>();

    expect(EPUB_ILLUSTRATION_MAX_BYTES).toBeGreaterThan(0);
    expect(EPUB_ILLUSTRATION_IMAGE_CONTRACT.maximumBytes).toBe(EPUB_ILLUSTRATION_MAX_BYTES);
    expect(new Set(mediaTypes).size).toBe(mediaTypes.length);
    for (const imageType of EPUB_ILLUSTRATION_IMAGE_TYPES) {
      expect(imageType.extensions.length).toBeGreaterThan(0);
      expect(new Set(imageType.extensions).size).toBe(imageType.extensions.length);
      expect(imageType.extensions).toContain(imageType.preferredExtension);
      expect(
        epubIllustrationFileExtension(
          `C:\\Exports\\plate.${imageType.preferredExtension}`,
          imageType,
        ),
      ).toBe(imageType.preferredExtension);
      for (const extension of imageType.extensions) {
        expect(extensionOwners.has(extension)).toBe(false);
        extensionOwners.set(extension, imageType.mediaType);
      }
    }
  });

  it("keeps JPEG aliases and rejects extensions from another image type", () => {
    const jpeg = epubIllustrationImageType("IMAGE/JPEG; charset=binary")!;
    expect(epubIllustrationFileExtension("plate.JPEG", jpeg)).toBe("jpeg");
    expect(epubIllustrationFileExtension("plate.png", jpeg)).toBeUndefined();
    expect(jpeg.extensions).toEqual(["jpg", "jpeg"]);
  });

  it.each([
    ["Images/Étoiles du soir.JPG", "Étoiles du soir.jpg"],
    ["Images/図版 🌙.png", "図版 🌙.png"],
    ["Images/plate:detail.webp", "plate-detail.webp"],
  ])("sanitizes source filename %s without making it ASCII-only", (href, expected) => {
    expect(
      epubIllustrationExportFileName(
        href,
        href.toLowerCase().endsWith(".webp")
          ? "image/webp"
          : href.toLowerCase().endsWith(".png")
            ? "image/png"
            : "image/jpeg",
      ),
    ).toBe(expected);
  });

  it.each([
    ["Images/.jpg", "image/jpeg", "illustration.jpg"],
    ["Images/CON.jpeg", "image/jpeg", "illustration.jpg"],
    ["Images/CON.detail.jpg", "image/jpeg", "illustration.jpg"],
    ["Images/plate.bin", "image/png", "illustration.png"],
    ["", "image/avif", "illustration.avif"],
  ])("uses a safe fallback for unusable source name %s", (href, mediaType, expected) => {
    expect(epubIllustrationExportFileName(href, mediaType)).toBe(expected);
  });

  it("defines exactly the five resolver and export media types", () => {
    expect(EPUB_ILLUSTRATION_IMAGE_TYPES).toHaveLength(5);
    expect(epubIllustrationImageType("image/avif")).toBeDefined();
    expect(epubIllustrationImageType("image/gif")).toBeDefined();
    expect(epubIllustrationImageType("image/jpeg")).toBeDefined();
    expect(epubIllustrationImageType("image/png")).toBeDefined();
    expect(epubIllustrationImageType("image/webp")).toBeDefined();
    expect(epubIllustrationImageType("image/svg+xml")).toBeUndefined();
  });
});
