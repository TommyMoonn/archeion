import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Book } from "../../types/book";
import {
  parseEpubMetadata,
  type ParsedEpubMetadata,
} from "./parseEpubMetadata";

export type ImportEpubDependencies = {
  parseMetadata: (file: File) => Promise<ParsedEpubMetadata>;
  saveBook: (input: {
    fileName: string;
    fileBlob: Blob;
    originalTitle: string;
    originalAuthor: string;
    coverBlob?: Blob;
  }) => Promise<Book>;
};

export type ImportResult =
  | {
      status: "imported";
      fileName: string;
      book: Book;
    }
  | {
      status: "failed";
      fileName: string;
      message: string;
    };

export function createImportEpubDependencies(
  storage: Pick<LibraryStorage, "createBook">,
): ImportEpubDependencies {
  return {
    parseMetadata: parseEpubMetadata,
    saveBook: (input) => storage.createBook(input),
  };
}

export function isEpubFile(file: File): boolean {
  return /\.epub$/i.test(file.name);
}

export async function importEpub(
  file: File,
  dependencies: ImportEpubDependencies,
): Promise<Book> {
  if (!isEpubFile(file)) {
    throw new Error("Only EPUB files can be imported.");
  }

  if (file.size === 0) {
    throw new Error("This file is empty.");
  }

  let metadata: ParsedEpubMetadata;

  try {
    metadata = await dependencies.parseMetadata(file);
  } catch (error) {
    throw new Error(
      "This EPUB could not be read. It may be invalid or corrupted.",
      { cause: error },
    );
  }

  try {
    return await dependencies.saveBook({
      fileName: file.name,
      fileBlob: file,
      originalTitle: metadata.title,
      originalAuthor: metadata.author,
      ...(metadata.coverBlob ? { coverBlob: metadata.coverBlob } : {}),
    });
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "QuotaExceededError"
        ? "There is not enough browser storage for this book."
        : "This book could not be saved to this device.";

    throw new Error(message, { cause: error });
  }
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The file could not be imported.";
}

export async function importEpubFiles(
  files: File[],
  dependencies: ImportEpubDependencies,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];

  for (const file of files) {
    try {
      const book = await importEpub(file, dependencies);

      results.push({
        status: "imported",
        fileName: file.name,
        book,
      });
    } catch (error) {
      results.push({
        status: "failed",
        fileName: file.name,
        message: messageFromError(error),
      });
    }
  }

  return results;
}
