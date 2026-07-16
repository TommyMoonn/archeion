import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import {
  EPUB_ILLUSTRATION_MAX_BYTES,
  epubIllustrationExportFileName,
  epubIllustrationFileExtension,
  epubIllustrationImageType,
} from "./epubIllustrationImage";
import type { ResolvedEpubIllustration } from "./epubIllustrationResolver";

export type ReaderIllustrationExportResult =
  Readonly<{ status: "cancelled" }> | Readonly<{ path: string; status: "saved" }>;

type ReaderIllustrationExportDependencies = Readonly<{
  invoke: (
    command: string,
    args: Uint8Array,
    options: Readonly<{ headers: Record<string, string> }>,
  ) => Promise<unknown>;
  save: typeof save;
}>;

const nativeDependencies: ReaderIllustrationExportDependencies = {
  invoke: (command, args, options) => invoke(command, args, options),
  save,
};

export async function exportReaderIllustrationToFile(
  resource: ResolvedEpubIllustration,
  dependencies: ReaderIllustrationExportDependencies = nativeDependencies,
): Promise<ReaderIllustrationExportResult> {
  const imageType = epubIllustrationImageType(resource.mediaType);
  if (!imageType) throw new Error("This illustration type cannot be saved.");
  validateIllustrationBlob(resource);

  const path = await dependencies.save({
    defaultPath: epubIllustrationExportFileName(resource.href, resource.mediaType),
    filters: [{ extensions: [...imageType.extensions], name: imageType.label }],
    title: "Save illustration image",
  });
  if (!path) return { status: "cancelled" };
  if (!epubIllustrationFileExtension(path, imageType)) {
    throw new Error(
      `${imageType.label} exports require a ${extensionList(imageType.extensions)} file name.`,
    );
  }

  const contents = new Uint8Array(await resource.blob.arrayBuffer());
  if (contents.byteLength <= 0 || contents.byteLength > EPUB_ILLUSTRATION_MAX_BYTES) {
    throw new Error("The illustration is too large to save safely.");
  }
  if (contents.byteLength !== resource.byteLength) {
    throw new Error("The illustration source changed before it could be saved.");
  }

  await dependencies.invoke("write_illustration_image_file", contents, {
    headers: {
      "x-archeion-illustration-media-type": imageType.mediaType,
      "x-archeion-illustration-path": encodeURIComponent(path),
    },
  });
  return { path, status: "saved" };
}

function validateIllustrationBlob(resource: ResolvedEpubIllustration): void {
  if (
    resource.blob.size <= 0 ||
    resource.blob.size > EPUB_ILLUSTRATION_MAX_BYTES ||
    resource.blob.size !== resource.byteLength
  ) {
    throw new Error("The illustration source is unavailable or too large to save safely.");
  }
}

function extensionList(extensions: readonly string[]): string {
  return extensions.map((extension) => `.${extension}`).join(" or ");
}
