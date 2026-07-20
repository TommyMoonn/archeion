import { beforeEach, describe, expect, it } from "vitest";

import type { Book } from "../types/book";
import type { LibraryMetadata, MetadataBundle, ProgressMetadata } from "./metadataFiles";
import type { ArchiveEpubScan, ArchiveScan } from "./reconcileLibraryState";
import { deferred, invokeMock, setupDefaultStorageMock } from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";

const ROOT_A = "C:/ArchiveA";
const ROOT_B = "C:/ArchiveB";

function stateArchive(prefix = "Source"): { metadata: MetadataBundle; scan: ArchiveScan } {
  const entries = [
    { id: "book-1", name: "One.epub", size: 1_024, favorite: true },
    { id: "book-2", name: "Two.epub", size: 2_048, favorite: false },
    { id: "book-3", name: "Stable.epub", size: 3_072, favorite: false },
  ];
  const libraryBooks: LibraryMetadata["books"] = {};
  const progress: ProgressMetadata["progress"] = {};
  for (const [index, entry] of entries.entries()) {
    const relativePath = `${prefix}/${entry.name}`;
    libraryBooks[entry.id] = {
      relativePath,
      isFavorite: entry.favorite,
      fileSize: entry.size,
      fileModifiedAt: 1_700_000_000_000 + index,
      sourceMetadata: { identifier: `urn:${entry.id}`, title: entry.name.replace(".epub", "") },
      addedAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    };
    progress[entry.id] = {
      cfi: `epubcfi(/6/${index + 2})`,
      percent: (index + 1) * 10,
      lastOpenedAt: "2026-07-17T00:00:00.000Z",
    };
  }

  return {
    metadata: {
      library: { version: 1, books: libraryBooks },
      progress: { version: 1, progress },
      settings: {
        version: 2,
        import: {},
        appearance: {
          appTheme: { kind: "inherit" },
          readerTheme: { kind: "inherit" },
        },
      },
    },
    scan: {
      folders: [
        { id: `folder:${prefix}`, name: prefix, relativePath: prefix, parentPath: null },
        {
          id: "folder:Destination",
          name: "Destination",
          relativePath: "Destination",
          parentPath: null,
        },
      ],
      books: entries.map((entry, index) => ({
        discoveryId: entry.id,
        relativePath: `${prefix}/${entry.name}`,
        fileName: entry.name,
        folderPath: prefix,
        size: entry.size,
        modifiedAt: 1_700_000_000_000 + index,
        sourceMetadata: {
          identifier: `urn:${entry.id}`,
          title: entry.name.replace(".epub", ""),
        },
      })),
    },
  };
}

async function loadStorage(archive = stateArchive()) {
  invokeMock.mockImplementation(async (command) => {
    if (command === "scan_archive") return structuredClone(archive.scan);
    if (command === "load_archive_metadata") return structuredClone(archive.metadata);
    return undefined;
  });
  const storage = new TauriArchiveLibraryStorage();
  storage.reset(ROOT_A);
  await storage.listBooks();
  invokeMock.mockClear();
  return storage;
}

function byId(books: readonly Book[], id: string): Book {
  const book = books.find((candidate) => candidate.id === id);
  if (!book) throw new Error(`Missing test book ${id}.`);
  return book;
}

describe("TauriArchiveLibraryStorage serialized metadata-only mutations", () => {
  beforeEach(setupDefaultStorageMock);

  it.each(["move-first", "favorite-first"] as const)(
    "composes a move and favorite update in %s queue order",
    async (order) => {
      const storage = await loadStorage();
      const firstSaveStarted = deferred<void>();
      const releaseFirstSave = deferred<void>();
      const savedLibraries: LibraryMetadata[] = [];
      let saveCount = 0;
      invokeMock.mockImplementation(async (command, args) => {
        const commandArgs = args as Record<string, unknown>;
        if (command === "move_archive_epub_file") {
          return {
            oldRelativePath: "Source/One.epub",
            newRelativePath: "Destination/One.epub",
          };
        }
        if (command === "save_library_metadata") {
          saveCount += 1;
          savedLibraries.push(structuredClone(commandArgs.metadata as LibraryMetadata));
          if (saveCount === 1) {
            firstSaveStarted.resolve();
            await releaseFirstSave.promise;
          }
        }
        return undefined;
      });

      const before = await storage.listBooks();
      const stable = byId(before, "book-3");
      const first =
        order === "move-first"
          ? storage.moveBookToFolder("book-1", "folder:Destination")
          : storage.updateBook("book-1", { isFavorite: false });
      await firstSaveStarted.promise;
      const second =
        order === "move-first"
          ? storage.updateBook("book-1", { isFavorite: false })
          : storage.moveBookToFolder("book-1", "folder:Destination");
      releaseFirstSave.resolve();
      await Promise.all([first, second]);

      await expect(storage.getBook("book-1")).resolves.toMatchObject({
        relativePath: "Destination/One.epub",
        isFavorite: false,
      });
      expect(await storage.getBook("book-3")).toBe(stable);
      expect(savedLibraries.at(-1)?.books["book-1"]).toMatchObject({
        relativePath: "Destination/One.epub",
        isFavorite: false,
      });
    },
  );

  it.each(["scan-first", "progress-first"] as const)(
    "composes a full scan and progress update in %s queue order",
    async (order) => {
      const archive = stateArchive();
      const storage = await loadStorage(archive);
      const persisted = structuredClone(archive.metadata);
      const firstSaveStarted = deferred<void>();
      const releaseFirstSave = deferred<void>();
      const changedScan = structuredClone(archive.scan);
      changedScan.books[0] = {
        ...changedScan.books[0],
        relativePath: "Destination/One.epub",
        folderPath: "Destination",
      };
      let firstSave = true;
      invokeMock.mockImplementation(async (command, args) => {
        const commandArgs = args as Record<string, unknown>;
        if (command === "scan_archive") return structuredClone(changedScan);
        if (command === "load_archive_metadata") return structuredClone(persisted);
        if (command === "save_library_metadata") {
          persisted.library = structuredClone(commandArgs.metadata as LibraryMetadata);
          if (firstSave) {
            firstSave = false;
            firstSaveStarted.resolve();
            await releaseFirstSave.promise;
          }
        }
        if (command === "save_progress_metadata") {
          persisted.progress = structuredClone(commandArgs.metadata as ProgressMetadata);
          if (firstSave) {
            firstSave = false;
            firstSaveStarted.resolve();
            await releaseFirstSave.promise;
          }
        }
        return undefined;
      });

      const first =
        order === "scan-first"
          ? storage.rescan({ quiet: true })
          : storage.updateBook("book-1", { progressPercent: 73 });
      await firstSaveStarted.promise;
      const second =
        order === "scan-first"
          ? storage.updateBook("book-1", { progressPercent: 73 })
          : storage.rescan({ quiet: true });
      releaseFirstSave.resolve();
      await Promise.all([first, second]);

      await expect(storage.getBook("book-1")).resolves.toMatchObject({
        relativePath: "Destination/One.epub",
        progressPercent: 73,
      });
      expect(persisted.progress.progress["book-1"].percent).toBe(73);
    },
  );

  it("does not recreate a deleted book from a queued favorite update", async () => {
    const storage = await loadStorage();
    const deletionSaveStarted = deferred<void>();
    const releaseDeletionSave = deferred<void>();
    let firstLibrarySave = true;
    invokeMock.mockImplementation(async (command) => {
      if (command === "delete_archive_epub_file") return {};
      if (command === "save_library_metadata" && firstLibrarySave) {
        firstLibrarySave = false;
        deletionSaveStarted.resolve();
        await releaseDeletionSave.promise;
      }
      return undefined;
    });

    const deletion = storage.deleteBook("book-1");
    await deletionSaveStarted.promise;
    const favorite = storage.updateBook("book-1", { isFavorite: false });
    releaseDeletionSave.resolve();

    await expect(deletion).resolves.toBe(true);
    await expect(favorite).rejects.toThrow('Book "book-1" was not found.');
    await expect(storage.getBook("book-1")).resolves.toBeUndefined();
  });

  it("composes bulk favorites with a targeted watcher update", async () => {
    const archive = stateArchive();
    const storage = await loadStorage(archive);
    const favoriteSaveStarted = deferred<void>();
    const releaseFavoriteSave = deferred<void>();
    const targeted: ArchiveEpubScan = {
      books: [
        {
          ...archive.scan.books[1],
          sourceMetadata: { identifier: "urn:book-2", title: "Externally changed" },
          size: 9_999,
          modifiedAt: 1_700_000_099_999,
        },
      ],
      missingRelativePaths: [],
      warnings: [],
    };
    const savedLibraries: LibraryMetadata[] = [];
    let firstLibrarySave = true;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive_epub_paths") return structuredClone(targeted);
      if (command === "save_library_metadata") {
        savedLibraries.push(structuredClone((args as { metadata: LibraryMetadata }).metadata));
        if (firstLibrarySave) {
          firstLibrarySave = false;
          favoriteSaveStarted.resolve();
          await releaseFavoriteSave.promise;
        }
      }
      return undefined;
    });

    const favorites = storage.bulkSetFavorite(["book-1", "book-2"], true);
    await favoriteSaveStarted.promise;
    const watcher = storage.applyArchiveWatcherChanges({
      changes: [{ kind: "modify", relativePaths: ["Source/Two.epub"] }],
    });
    releaseFavoriteSave.resolve();
    await Promise.all([favorites, watcher]);

    await expect(storage.getBook("book-1")).resolves.toMatchObject({ isFavorite: true });
    await expect(storage.getBook("book-2")).resolves.toMatchObject({
      isFavorite: true,
      size: 9_999,
      sourceMetadata: { title: "Externally changed" },
    });
    expect(savedLibraries.at(-1)?.books["book-2"]).toMatchObject({
      isFavorite: true,
      sourceMetadata: { title: "Externally changed" },
    });
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
  });

  it("merges two queued progress updates against the latest progress entry", async () => {
    const storage = await loadStorage();
    const firstSaveStarted = deferred<void>();
    const releaseFirstSave = deferred<void>();
    const saved: ProgressMetadata[] = [];
    let saveCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "save_progress_metadata") {
        saveCount += 1;
        saved.push(structuredClone((args as { metadata: ProgressMetadata }).metadata));
        if (saveCount === 1) {
          firstSaveStarted.resolve();
          await releaseFirstSave.promise;
        }
      }
      return undefined;
    });

    const first = storage.updateBook("book-1", { progressPercent: 65 });
    await firstSaveStarted.promise;
    const second = storage.updateBook("book-1", { progressCfi: "epubcfi(/6/20)" });
    releaseFirstSave.resolve();
    await Promise.all([first, second]);

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      progressPercent: 65,
      progressCfi: "epubcfi(/6/20)",
    });
    expect(saved.at(-1)?.progress["book-1"]).toMatchObject({
      percent: 65,
      cfi: "epubcfi(/6/20)",
    });
  });

  it("drops queued Archive A mutations after switching to Archive B", async () => {
    const archiveA = stateArchive("Source");
    const archiveB = stateArchive("Replacement");
    const storage = await loadStorage(archiveA);
    const favoriteSaveStarted = deferred<void>();
    const releaseFavoriteSave = deferred<void>();
    const saves: Array<{ command: string; rootPath: unknown }> = [];
    let blockFavorite = true;
    invokeMock.mockImplementation(async (command, args) => {
      const commandArgs = args as Record<string, unknown>;
      const rootPath = commandArgs.rootPath;
      if (command === "scan_archive") {
        return structuredClone(rootPath === ROOT_B ? archiveB.scan : archiveA.scan);
      }
      if (command === "load_archive_metadata") {
        return structuredClone(rootPath === ROOT_B ? archiveB.metadata : archiveA.metadata);
      }
      if (command === "save_library_metadata" || command === "save_progress_metadata") {
        saves.push({ command, rootPath });
      }
      if (command === "save_library_metadata" && blockFavorite) {
        blockFavorite = false;
        favoriteSaveStarted.resolve();
        await releaseFavoriteSave.promise;
      }
      return undefined;
    });

    const emissions: Book[][] = [];
    storage.observeBooks({ next: (books) => emissions.push(books) });
    const favorite = storage.updateBook("book-1", { isFavorite: false });
    await favoriteSaveStarted.promise;
    const progress = storage.updateBook("book-1", { progressPercent: 88 });
    storage.reset(ROOT_B);
    const emissionsAfterReset = emissions.length;
    releaseFavoriteSave.resolve();
    await Promise.all([favorite, progress]);

    expect(emissions).toHaveLength(emissionsAfterReset);
    await storage.listBooks();

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      relativePath: "Replacement/One.epub",
      isFavorite: true,
      progressPercent: 10,
    });
    expect(
      saves.some(
        ({ command, rootPath }) => command === "save_progress_metadata" && rootPath === ROOT_A,
      ),
    ).toBe(false);
    expect(saves.some(({ rootPath }) => rootPath === ROOT_B)).toBe(false);
  });

  it("rejects a combined favorite and progress mutation before queueing persistence", async () => {
    const storage = await loadStorage();
    const savedCommands: string[] = [];
    invokeMock.mockImplementation(async (command) => {
      if (command === "save_library_metadata") {
        savedCommands.push(command);
      }
      if (command === "save_progress_metadata") {
        savedCommands.push(command);
      }
      return undefined;
    });

    const mutation = storage.updateBook("book-1", {
      isFavorite: false,
      progressPercent: 88,
    });

    await expect(mutation).rejects.toThrow(
      "Favorite and reading progress changes must be saved as separate updates.",
    );
    expect(savedCommands).toEqual([]);
  });

  it.each([
    {
      command: "save_library_metadata",
      changes: { isFavorite: false },
      expected: { isFavorite: true },
    },
    {
      command: "save_progress_metadata",
      changes: { progressPercent: 91 },
      expected: { progressPercent: 10 },
    },
  ] as const)(
    "restores books and metadata when $command fails",
    async ({ command: failingCommand, changes, expected }) => {
      const storage = await loadStorage();
      const before = await storage.listBooks();
      const bookBefore = byId(before, "book-1");
      const emissions: Book[][] = [];
      storage.observeBooks({ next: (books) => emissions.push(books) });
      invokeMock.mockImplementation(async (command) => {
        if (command === failingCommand) throw new Error("disk full");
        return undefined;
      });

      await expect(storage.updateBook("book-1", changes)).rejects.toThrow("disk full");

      if (failingCommand === "save_library_metadata") {
        expect(await storage.getBook("book-1")).toBe(bookBefore);
      }
      await expect(storage.getBook("book-1")).resolves.toMatchObject(expected);
      expect(emissions).toHaveLength(failingCommand === "save_progress_metadata" ? 3 : 1);
    },
  );
});
