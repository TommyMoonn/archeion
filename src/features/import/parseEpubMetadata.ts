import type { Book } from "epubjs";

export type ParsedEpubMetadata = {
  title: string;
  author: string;
  coverBlob?: Blob;
};

function cleanMetadataValue(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();

  return cleaned || undefined;
}

export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.epub$/i, "");
  const cleaned = withoutExtension.replaceAll(/[_-]+/g, " ").trim();

  return cleaned || "Untitled";
}

async function extractCover(book: Book) {
  let coverUrl: string | null = null;

  try {
    coverUrl = await book.coverUrl();

    if (!coverUrl) {
      return undefined;
    }

    const response = await fetch(coverUrl);

    if (!response.ok) {
      return undefined;
    }

    return await response.blob();
  } catch {
    return undefined;
  } finally {
    if (coverUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(coverUrl);
    }
  }
}

export async function parseEpubMetadata(
  file: File,
): Promise<ParsedEpubMetadata> {
  const { default: ePub } = await import("epubjs");
  const book = ePub(await file.arrayBuffer());

  try {
    await book.opened;

    const metadata = await book.loaded.metadata;
    const coverBlob = await extractCover(book);

    return {
      title: cleanMetadataValue(metadata.title) ?? titleFromFileName(file.name),
      author: cleanMetadataValue(metadata.creator) ?? "Unknown author",
      ...(coverBlob ? { coverBlob } : {}),
    };
  } finally {
    book.destroy();
  }
}
