import { describe, expect, it } from "vitest";
import corpus from "./fixtures/library-presentation/v1.json";
import { reconcileLibraryState } from "../src/storage/reconcileLibraryState";
import type { LibraryMetadata } from "../src/storage/metadataFiles";
import { resolveReaderPresentation } from "../src/types/reader";
import { readerPresentationForPublication } from "../src/features/reader/readerSettingsCapabilities";

describe("library presentation v1 cross-language contract", () => {
  it.each(corpus.cases)("$name", ({ entry, expected }) => {
    const metadata = {
      version: 1,
      books: {
        stable: {
          relativePath: "Book.epub",
          isFavorite: true,
          addedAt: "added",
          updatedAt: "updated",
          ...entry,
        },
      },
    } as LibraryMetadata;
    const result = reconcileLibraryState({
      libraryMetadata: metadata,
      progressMetadata: { version: 1, progress: {} },
      previousBooks: [],
      previousFolders: [],
      timestamp: "now",
      scan: {
        folders: [],
        books: [
          {
            discoveryId: "discovery",
            relativePath: "Book.epub",
            fileName: "Book.epub",
            folderPath: "",
            size: 100,
            modifiedAt: 1000,
          },
        ],
      },
    });
    expect(result.books[0].readerPresentation).toBe(expected);
    expect(result.libraryMetadata.books.stable.isFavorite).toBe(true);
    expect(result.libraryMetadata.books.stable.addedAt).toBe("added");
    expect(metadata.books.stable.updatedAt).toBe("updated");
    expect(resolveReaderPresentation(entry.readerPresentation)).toBe(expected);
    expect(readerPresentationForPublication(entry.readerPresentation, "reflowable")).toBe(expected);
    expect(readerPresentationForPublication(entry.readerPresentation, "fixed-layout")).toBe(
      "publisher",
    );
  });
});
