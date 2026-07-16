import { describe, expect, it, vi } from "vitest";

import {
  EPUB_ILLUSTRATION_IMAGE_TYPES,
  EPUB_ILLUSTRATION_MAX_BYTES,
} from "./epubIllustrationImage";
import type { ResolvedEpubIllustration } from "./epubIllustrationResolver";
import { exportReaderIllustrationToFile } from "./readerIllustrationExportFile";

function resource(overrides: Partial<ResolvedEpubIllustration> = {}): ResolvedEpubIllustration {
  const blob = overrides.blob ?? new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  return Object.freeze({
    blob,
    byteLength: blob.size,
    height: 600,
    href: "Images/plate.jpg",
    mediaType: "image/jpeg",
    release: vi.fn(),
    url: "blob:illustration",
    width: 800,
    ...overrides,
  });
}

function dependencies(path: string | null = "C:\\Exports\\plate.jpg") {
  return {
    invoke: vi.fn(async () => undefined),
    save: vi.fn(async () => path),
  };
}

describe("exportReaderIllustrationToFile", () => {
  it.each(EPUB_ILLUSTRATION_IMAGE_TYPES)(
    "writes original $mediaType bytes through its matching native filter",
    async (imageType) => {
      const { extensions, mediaType, preferredExtension } = imageType;
      const href = `Images/plate.${preferredExtension}`;
      const path = `C:\\Exports\\plate.${preferredExtension}`;
      const blob = new Blob([new Uint8Array([7, 8, 9])], { type: mediaType });
      const owner = dependencies(path);

      await expect(
        exportReaderIllustrationToFile(
          resource({ blob, byteLength: blob.size, href, mediaType }),
          owner,
        ),
      ).resolves.toEqual({ path, status: "saved" });

      expect(owner.save).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: href.split("/").pop(),
          filters: [expect.objectContaining({ extensions: [...extensions] })],
          title: "Save illustration image",
        }),
      );
      expect(owner.invoke).toHaveBeenCalledWith(
        "write_illustration_image_file",
        new Uint8Array([7, 8, 9]),
        {
          headers: {
            "x-archeion-illustration-media-type": mediaType,
            "x-archeion-illustration-path": encodeURIComponent(path),
          },
        },
      );
    },
  );

  it("treats save-dialog cancellation as a no-op without preparing bytes", async () => {
    const blob = resource().blob;
    const arrayBuffer = vi.spyOn(blob, "arrayBuffer");
    const owner = dependencies(null);

    await expect(exportReaderIllustrationToFile(resource({ blob }), owner)).resolves.toEqual({
      status: "cancelled",
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(owner.invoke).not.toHaveBeenCalled();
  });

  it("rejects a mismatched destination extension before native IO", async () => {
    const owner = dependencies("C:\\Exports\\plate.png");
    await expect(exportReaderIllustrationToFile(resource(), owner)).rejects.toThrow(
      "JPEG image exports require a .jpg or .jpeg file name.",
    );
    expect(owner.invoke).not.toHaveBeenCalled();
  });

  it("rejects empty, oversized, and changed source byte lengths", async () => {
    const fakeOversizedBlob = {
      arrayBuffer: vi.fn(),
      size: EPUB_ILLUSTRATION_MAX_BYTES + 1,
    } as unknown as Blob;
    await expect(
      exportReaderIllustrationToFile(
        resource({ blob: new Blob([]), byteLength: 0 }),
        dependencies(),
      ),
    ).rejects.toThrow("unavailable or too large");
    await expect(
      exportReaderIllustrationToFile(
        resource({ blob: fakeOversizedBlob, byteLength: fakeOversizedBlob.size }),
        dependencies(),
      ),
    ).rejects.toThrow("unavailable or too large");
    await expect(
      exportReaderIllustrationToFile(resource({ byteLength: 4 }), dependencies()),
    ).rejects.toThrow("unavailable or too large");
  });

  it("keeps captured source bytes valid after object-URL release", async () => {
    let choosePath: ((path: string) => void) | undefined;
    const owner = dependencies();
    owner.save.mockImplementationOnce(
      () => new Promise((resolve) => (choosePath = resolve as (path: string) => void)),
    );
    const illustration = resource();
    const pending = exportReaderIllustrationToFile(illustration, owner);

    illustration.release();
    choosePath?.("C:\\Exports\\plate.jpg");
    await pending;

    expect(illustration.release).toHaveBeenCalledOnce();
    expect(owner.invoke).toHaveBeenCalledWith(
      "write_illustration_image_file",
      new Uint8Array([1, 2, 3]),
      expect.any(Object),
    );
  });
});
