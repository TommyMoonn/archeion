import { beforeEach, describe, expect, it } from "vitest";
import {
  deferred,
  invokeMock,
  setupDefaultStorageMock,
  mockStorageCommands,
  twoBookArchive,
  metadata,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";
import type { MetadataBundle } from "./metadataFiles";
import type { ArchiveScan } from "./reconcileLibraryState";
import { createReaderPresentationController } from "../features/reader/readerPresentationController";

function durableArchive() {
  const archive = twoBookArchive("Books");
  let scan: ArchiveScan = structuredClone(archive.scan);
  for (const book of scan.books) {
    book.sourceMetadata = { ...book.sourceMetadata, identifier: book.discoveryId };
    const entry = (archive.metadata as MetadataBundle).library.books[book.discoveryId];
    entry.sourceMetadata = { ...entry.sourceMetadata, identifier: book.discoveryId };
  }
  const disk: MetadataBundle = structuredClone(archive.metadata);
  mockStorageCommands({
    scan_archive: () => structuredClone(scan),
    load_archive_metadata: () => structuredClone(disk),
    save_library_metadata: (args) => {
      disk.library = structuredClone(args!.metadata);
    },
    delete_archive_epub_file: () => ({}),
  });
  return {
    get disk() {
      return disk;
    },
    get scan() {
      return scan;
    },
    set scan(value) {
      scan = value;
    },
  };
}

describe("per-book Reader presentation", () => {
  beforeEach(setupDefaultStorageMock);

  it("keeps layout on successful book rename and containing-folder move", async () => {
    const disk: MetadataBundle = structuredClone(metadata);
    mockStorageCommands({
      load_archive_metadata: () => structuredClone(disk),
      save_library_metadata: (args) => {
        disk.library = structuredClone(args!.metadata);
      },
      rename_archive_epub_file: () => ({
        oldRelativePath: "Author/Series/Volume_01.epub",
        newRelativePath: "Author/Series/Renamed.epub",
      }),
      move_archive_folder: () => ({ oldRelativePath: "Author/Series", newRelativePath: "Series" }),
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    await storage.updateBook("book-1", { readerPresentation: "publisher" });
    expect(await storage.renameBookFile("book-1", "Renamed.epub")).toMatchObject({
      id: "book-1",
      readerPresentation: "publisher",
      relativePath: "Author/Series/Renamed.epub",
    });
    await storage.updateFolder("folder:Author/Series", { parentId: null });
    expect(await storage.getBook("book-1")).toMatchObject({
      id: "book-1",
      readerPresentation: "publisher",
      relativePath: "Series/Renamed.epub",
    });
    expect(disk.library.books["book-1"]).toMatchObject({
      readerPresentation: "publisher",
      relativePath: "Series/Renamed.epub",
      isFavorite: true,
    });
  });

  it("saves the choice to library metadata without touching progress or EPUB bytes", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    invokeMock.mockClear();
    await storage.updateBook("book-1", { readerPresentation: "publisher" });
    expect((await storage.getBook("book-1"))?.readerPresentation).toBe("publisher");
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["save_library_metadata"]);
    expect(invokeMock).toHaveBeenCalledWith("save_library_metadata", {
      metadata: expect.objectContaining({
        version: 1,
        books: expect.objectContaining({
          "book-1": expect.objectContaining({ readerPresentation: "publisher", isFavorite: true }),
        }),
      }),
    });
  });

  it("preserves independent books through restart, repeated scans and stable-ID rename/move", async () => {
    const archive = durableArchive();
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    await storage.updateBook("book-1", { readerPresentation: "publisher" });
    expect((await storage.getBook("book-2"))?.readerPresentation).toBe("archeion");
    for (const path of ["Books/Renamed.epub", "Moved/Renamed.epub"]) {
      archive.scan = {
        ...archive.scan,
        books: archive.scan.books.map((book) =>
          book.sourceMetadata?.identifier === "book-1"
            ? {
                ...book,
                discoveryId: `discovered:${path}`,
                relativePath: path,
                fileName: "Renamed.epub",
                folderPath: path.split("/")[0],
              }
            : book,
        ),
      };
      await storage.rescan();
      await storage.rescan();
      expect((await storage.getBook("book-1"))?.readerPresentation).toBe("publisher");
      expect((await storage.getBook("book-1"))?.relativePath).toBe(path);
    }
    const restarted = new TauriArchiveLibraryStorage();
    expect(
      (await restarted.listBooks()).find((book) => book.id === "book-1")?.readerPresentation,
    ).toBe("publisher");
    expect(archive.disk.progress).toEqual(twoBookArchive("Books").metadata.progress);
    await restarted.updateBook("book-1", { readerPresentation: "archeion" });
    expect(JSON.parse(JSON.stringify(archive.disk.library.books["book-1"]))).not.toHaveProperty(
      "readerPresentation",
    );
  });

  it("does not transfer presentation after deliberate deletion and readdition", async () => {
    const archive = durableArchive();
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    await storage.updateBook("book-1", { readerPresentation: "publisher" });
    await storage.deleteBook("book-1");
    expect(archive.disk.library.books).not.toHaveProperty("book-1");
    archive.scan = {
      ...archive.scan,
      books: archive.scan.books.map((book) =>
        book.discoveryId === "book-1"
          ? { ...book, discoveryId: "readded", size: 777, modifiedAt: 2000 }
          : book,
      ),
    };
    await storage.rescan();
    expect((await storage.getBook("readded"))?.readerPresentation).toBe("archeion");
  });

  it("isolates archives with overlapping titles and ignores an old archive write completion", async () => {
    const a = twoBookArchive("Same");
    const aMetadata: MetadataBundle = a.metadata;
    const b: { metadata: MetadataBundle; scan: typeof a.scan } = structuredClone(a);
    b.metadata.library.books = { other: b.metadata.library.books["book-1"] };
    b.scan.books = [{ ...b.scan.books[0], discoveryId: "other" }];
    const save = deferred<void>();
    const started = deferred<void>();
    mockStorageCommands({
      scan_archive: (args) => (args!.rootPath === "A" ? a.scan : b.scan),
      load_archive_metadata: (args) =>
        structuredClone(args!.rootPath === "A" ? aMetadata : b.metadata),
      save_library_metadata: (args) => {
        if (args!.rootPath === "A") {
          aMetadata.library = structuredClone(args!.metadata);
          started.resolve();
          return save.promise;
        }
      },
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("A");
    await storage.listBooks();
    const writing = storage.updateBook("book-1", { readerPresentation: "publisher" });
    await started.promise;
    storage.reset("B");
    save.resolve();
    expect(await writing).toBeUndefined();
    await storage.listBooks();
    expect((await storage.getBook("other"))?.readerPresentation).toBe("archeion");
    expect(storage.getLibrarySnapshot().archiveRootPath).toBe("B");
  });

  it("serializes revision races without overwriting a newer choice or sibling metadata", async () => {
    durableArchive();
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const save = deferred<void>();
    let calls = 0;
    mockStorageCommands({
      save_library_metadata: () => (++calls === 1 ? save.promise : undefined),
    });
    const first = storage.updateBook("book-1", { readerPresentation: "publisher" });
    const favorite = storage.updateBook("book-1", { isFavorite: false });
    const latest = storage.updateBook("book-1", { readerPresentation: "archeion" });
    save.resolve();
    await Promise.all([first, favorite, latest]);
    expect(await storage.getBook("book-1")).toMatchObject({
      readerPresentation: "archeion",
      isFavorite: false,
    });
    const saves = invokeMock.mock.calls.filter(([command]) => command === "save_library_metadata");
    expect(saves.at(-1)?.[1]).toMatchObject({
      metadata: {
        books: {
          "book-1": { readerPresentation: undefined, isFavorite: false },
          "book-2": { isFavorite: false },
        },
      },
    });
  });

  it("rolls back failed writes, retries user intent and synchronizes Reader subscribers", async () => {
    durableArchive();
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const reader = createReaderPresentationController(storage, "book-1");
    const secondReader = createReaderPresentationController(storage, "book-1");
    reader.activate();
    secondReader.activate();
    const save = deferred<void>();
    mockStorageCommands({ save_library_metadata: () => save.promise });
    const write = reader.commit("publisher");
    expect(reader.getSnapshot()).toEqual({ presentation: "publisher", status: "saving" });
    expect(secondReader.getSnapshot().presentation).toBe("archeion");
    save.reject(new Error("disk full"));
    expect(await write).toBe(false);
    expect(reader.getSnapshot()).toEqual({ presentation: "archeion", status: "failed" });
    expect((await storage.getBook("book-1"))?.readerPresentation).toBe("archeion");
    mockStorageCommands();
    expect(await reader.retry()).toBe(true);
    expect(reader.getSnapshot()).toEqual({ presentation: "publisher", status: "idle" });
    expect(secondReader.getSnapshot().presentation).toBe("publisher");
    reader.teardown();
    secondReader.teardown();
  });

  it("prevents obsolete save failures from rolling back newer Reader intent", async () => {
    durableArchive();
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const reader = createReaderPresentationController(storage, "book-1");
    reader.activate();
    const save = deferred<void>();
    let calls = 0;
    mockStorageCommands({
      save_library_metadata: () => (++calls === 1 ? save.promise : undefined),
    });
    const first = reader.commit("publisher");
    const latest = reader.commit("archeion");
    save.reject(new Error("disk full"));
    await Promise.all([first, latest]);
    expect(reader.getSnapshot()).toEqual({ presentation: "archeion", status: "idle" });
    reader.teardown();
  });

  it("refreshes another Reader window through the existing metadata watcher", async () => {
    durableArchive();
    const writer = new TauriArchiveLibraryStorage();
    const otherWindow = new TauriArchiveLibraryStorage();
    await Promise.all([writer.listBooks(), otherWindow.listBooks()]);
    const reader = createReaderPresentationController(otherWindow, "book-1");
    reader.activate();
    await writer.updateBook("book-1", { readerPresentation: "publisher" });
    expect(reader.getSnapshot().presentation).toBe("archeion");
    await otherWindow.applyArchiveWatcherChanges({
      changes: [{ kind: "metadata", relativePaths: [".archeion/library.json"] }],
    });
    expect(reader.getSnapshot()).toEqual({ presentation: "publisher", status: "idle" });
    reader.teardown();
  });

  it("invalidates pending Reader feedback on archive switch and teardown", async () => {
    durableArchive();
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const reader = createReaderPresentationController(storage, "book-1");
    reader.activate();
    const save = deferred<void>();
    const started = deferred<void>();
    mockStorageCommands({
      save_library_metadata: () => {
        started.resolve();
        return save.promise;
      },
    });
    const pending = reader.commit("publisher");
    await started.promise;
    storage.reset("different-archive");
    expect(reader.getSnapshot()).toEqual({ presentation: "archeion", status: "idle" });
    reader.teardown();
    save.reject(new Error("retired archive write"));
    expect(await pending).toBe(false);
    expect(reader.getSnapshot()).toEqual({ presentation: "archeion", status: "idle" });
  });
});
