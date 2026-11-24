import { beforeEach, describe, expect, it } from "vitest";

import {
  firstScan,
  invokeMock,
  metadata,
  mockStorageCommands,
  setupDefaultStorageMock,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import type { MetadataBundle } from "./metadataFiles";

const root = "C:/Library";
const relativePath = "Author/Series/Volume_01.epub";

describe("standalone managed Reader storage", () => {
  beforeEach(setupDefaultStorageMock);

  it("hydrates only the matched book and its saved state without scanning or rewriting the archive", async () => {
    mockStorageCommands({
      scan_archive: () => {
        throw new Error("The full archive must not be scanned");
      },
      scan_archive_epub_paths: () => ({
        books: [structuredClone(firstScan.books[0])],
        missingRelativePaths: [],
      }),
    });
    const storage = new TauriArchiveLibraryStorage();
    const book = await storage.openStandaloneBook(root, "book-1", relativePath);

    expect(book).toMatchObject({ id: "book-1", progressPercent: 42, progressCfi: "epubcfi(/6/2)" });
    expect(await storage.getBook("book-1")).toMatchObject({ id: "book-1" });
    expect(storage.getLibrarySnapshot().books).toHaveLength(1);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "load_archive_metadata",
      "scan_archive_epub_paths",
    ]);
    for (const [, args] of invokeMock.mock.calls) {
      expect(args).toHaveProperty("rootPath", root);
    }
  });

  it("scopes saved progress and presentation changes to the selected book", async () => {
    const other = "unrelated-book";
    const archive: MetadataBundle = structuredClone(metadata);
    archive.library.books[other] = {
      ...archive.library.books["book-1"],
      relativePath: "Other/Book.epub",
    };
    archive.progress.progress[other] = { ...archive.progress.progress["book-1"] };
    mockStorageCommands({
      load_archive_metadata: () => structuredClone(archive),
      scan_archive_epub_paths: () => ({
        books: [structuredClone(firstScan.books[0])],
        missingRelativePaths: [],
      }),
    });
    const storage = new TauriArchiveLibraryStorage();
    expect(await storage.openStandaloneBook(root, "book-1", relativePath)).toBeDefined();

    await storage.updateBook("book-1", { progressPercent: 56 });
    await storage.updateBook("book-1", { readerPresentation: "publisher" });

    const progressSave = invokeMock.mock.calls.find(
      ([command]) => command === "save_progress_metadata",
    );
    const presentationSave = invokeMock.mock.calls.find(
      ([command]) => command === "save_library_metadata",
    );
    expect(progressSave?.[1]).toMatchObject({ changedBookIds: ["book-1"] });
    expect(presentationSave?.[1]).toMatchObject({ changedBookIds: ["book-1"] });
    expect(storage.getLibrarySnapshot().books).toHaveLength(1);
  });

  it("does not adopt a stale book identity after metadata or file changes", async () => {
    mockStorageCommands({
      load_archive_metadata: () => ({
        ...structuredClone(metadata),
        library: {
          version: 1 as const,
          books: { "book-1": { ...metadata.library.books["book-1"], relativePath: "Other.epub" } },
        },
      }),
      scan_archive_epub_paths: () => ({
        books: [structuredClone(firstScan.books[0])],
        missingRelativePaths: [],
      }),
    });
    const storage = new TauriArchiveLibraryStorage();
    expect(await storage.openStandaloneBook(root, "book-1", relativePath)).toBeUndefined();
    expect(storage.getLibrarySnapshot().books).toHaveLength(0);
  });

  it("falls back when the targeted scan does not return the selected file", async () => {
    mockStorageCommands({
      scan_archive_epub_paths: () => ({ books: [], missingRelativePaths: [relativePath] }),
    });
    const storage = new TauriArchiveLibraryStorage();
    expect(await storage.openStandaloneBook(root, "book-1", relativePath)).toBeUndefined();
  });
});
