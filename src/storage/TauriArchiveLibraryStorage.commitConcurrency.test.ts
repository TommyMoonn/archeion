import { beforeEach, describe, expect, it } from "vitest";

import type { ReadonlyBook } from "../types/book";
import type { LibraryMetadata, MetadataBundle, ProgressMetadata } from "./metadataFiles";
import type { ArchiveEpubScan, ArchiveScan } from "./reconcileLibraryState";
import { deferred, invokeMock, setupDefaultStorageMock } from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";

const ROOT = "C:/ArchiveA";

function concurrentArchive(): { metadata: MetadataBundle; scan: ArchiveScan } {
  const entries = [
    {
      id: "book-1",
      relativePath: "Source/One.epub",
      size: 1_024,
      modifiedAt: 1_700_000_000_000,
      title: "One",
    },
    {
      id: "book-2",
      relativePath: "Source/Two.epub",
      size: 2_048,
      modifiedAt: 1_700_000_001_000,
      title: "Two",
    },
    {
      id: "book-3",
      relativePath: "Stable.epub",
      size: 3_072,
      modifiedAt: 1_700_000_002_000,
      title: "Stable",
    },
  ];
  const libraryBooks: LibraryMetadata["books"] = {};
  const progress: ProgressMetadata["progress"] = {};
  for (const entry of entries) {
    libraryBooks[entry.id] = {
      relativePath: entry.relativePath,
      isFavorite: entry.id === "book-1",
      fileSize: entry.size,
      fileModifiedAt: entry.modifiedAt,
      sourceMetadata: { identifier: `urn:${entry.id}`, title: entry.title },
      addedAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    };
    progress[entry.id] = {
      cfi: `epubcfi(/6/${entry.id.at(-1)})`,
      percent: Number(entry.id.at(-1)) * 10,
      lastOpenedAt: "2026-07-17T00:00:00.000Z",
    };
  }

  return {
    metadata: {
      library: { version: 1, books: libraryBooks },
      progress: { version: 1, progress },
      settings: {
        version: 3,
        import: {},
      },
    },
    scan: {
      folders: [
        { id: "folder:Source", name: "Source", relativePath: "Source", parentPath: null },
        { id: "folder:DestA", name: "DestA", relativePath: "DestA", parentPath: null },
        { id: "folder:DestB", name: "DestB", relativePath: "DestB", parentPath: null },
      ],
      books: entries.map((entry) => ({
        discoveryId: entry.id,
        relativePath: entry.relativePath,
        fileName: entry.relativePath.split("/").at(-1) ?? entry.relativePath,
        folderPath: entry.relativePath.split("/").slice(0, -1).join("/"),
        size: entry.size,
        modifiedAt: entry.modifiedAt,
        sourceMetadata: { identifier: `urn:${entry.id}`, title: entry.title },
      })),
    },
  };
}

async function loadedStorage() {
  const archive = concurrentArchive();
  invokeMock.mockImplementation(async (command) => {
    if (command === "scan_archive") return structuredClone(archive.scan);
    if (command === "load_archive_metadata") return structuredClone(archive.metadata);
    return undefined;
  });
  const storage = new TauriArchiveLibraryStorage();
  storage.reset(ROOT);
  await storage.listBooks();
  invokeMock.mockClear();
  return { archive, storage };
}

function pathById(books: readonly ReadonlyBook[]): Record<string, string | undefined> {
  return Object.fromEntries(books.map((book) => [book.id, book.relativePath]));
}

async function waitForCalls(command: string, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (invokeMock.mock.calls.filter(([candidate]) => candidate === command).length >= count) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for ${count} ${command} calls.`);
}

describe("TauriArchiveLibraryStorage archive-model commit serialization", () => {
  beforeEach(setupDefaultStorageMock);

  it("composes two simultaneous book moves against the latest committed state", async () => {
    const { storage } = await loadedStorage();
    const firstSaveStarted = deferred<void>();
    const releaseFirstSave = deferred<void>();
    const savedLibraries: LibraryMetadata[] = [];
    let saveCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      const commandArgs = args as Record<string, unknown>;
      if (command === "move_archive_epub_file") {
        const relativePath = String(commandArgs.relativePath);
        return {
          oldRelativePath: relativePath,
          newRelativePath: relativePath === "Source/One.epub" ? "DestA/One.epub" : "DestB/Two.epub",
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
    const stableBook = before.find((book) => book.id === "book-3");
    const observerA: Array<Record<string, string | undefined>> = [];
    const observerB: Array<Record<string, string | undefined>> = [];
    storage.observeLibrarySnapshot({
      next: (snapshot) => observerA.push(pathById([...snapshot.books])),
    });
    storage.observeLibrarySnapshot({
      next: (snapshot) => observerB.push(pathById([...snapshot.books])),
    });

    const firstMove = storage.moveBookToFolder("book-1", "folder:DestA");
    const secondMove = storage.moveBookToFolder("book-2", "folder:DestB");
    await waitForCalls("move_archive_epub_file", 2);
    await firstSaveStarted.promise;
    releaseFirstSave.resolve();
    await Promise.all([firstMove, secondMove]);

    expect(pathById(await storage.listBooks())).toMatchObject({
      "book-1": "DestA/One.epub",
      "book-2": "DestB/Two.epub",
      "book-3": "Stable.epub",
    });
    expect(await storage.getBook("book-3")).toBe(stableBook);
    expect(savedLibraries.at(-1)?.books).toMatchObject({
      "book-1": { relativePath: "DestA/One.epub" },
      "book-2": { relativePath: "DestB/Two.epub" },
      "book-3": { relativePath: "Stable.epub" },
    });
    expect(observerA).toEqual(observerB);
    expect(observerA.at(-1)).toMatchObject({
      "book-1": "DestA/One.epub",
      "book-2": "DestB/Two.epub",
    });
    expect(observerA.slice(1).every((state) => state["book-3"] === "Stable.epub")).toBe(true);
  });

  it("preserves a concurrent move and deletion including metadata cleanup", async () => {
    const { storage } = await loadedStorage();
    const firstSaveStarted = deferred<void>();
    const releaseFirstSave = deferred<void>();
    const savedLibraries: LibraryMetadata[] = [];
    const savedProgress: ProgressMetadata[] = [];
    let saveCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      const commandArgs = args as Record<string, unknown>;
      if (command === "move_archive_epub_file") {
        return {
          oldRelativePath: "Source/One.epub",
          newRelativePath: "DestA/One.epub",
        };
      }
      if (command === "delete_archive_epub_file") return {};
      if (command === "save_library_metadata") {
        saveCount += 1;
        savedLibraries.push(structuredClone(commandArgs.metadata as LibraryMetadata));
        if (saveCount === 1) {
          firstSaveStarted.resolve();
          await releaseFirstSave.promise;
        }
      }
      if (command === "save_progress_metadata") {
        savedProgress.push(structuredClone(commandArgs.metadata as ProgressMetadata));
      }
      return undefined;
    });

    const move = storage.moveBookToFolder("book-1", "folder:DestA");
    const deletion = storage.deleteBook("book-2");
    await waitForCalls("move_archive_epub_file", 1);
    await waitForCalls("delete_archive_epub_file", 1);
    await firstSaveStarted.promise;
    releaseFirstSave.resolve();
    await Promise.all([move, deletion]);

    expect(pathById(await storage.listBooks())).toMatchObject({
      "book-1": "DestA/One.epub",
      "book-3": "Stable.epub",
    });
    await expect(storage.getBook("book-2")).resolves.toBeUndefined();
    expect(savedLibraries.at(-1)?.books["book-1"].relativePath).toBe("DestA/One.epub");
    expect(savedLibraries.at(-1)?.books["book-2"]).toBeUndefined();
    expect(savedProgress.at(-1)?.progress["book-2"]).toBeUndefined();
  });

  it("composes a targeted watcher update with an app-owned path change", async () => {
    const { archive, storage } = await loadedStorage();
    const moveResult = deferred<{ oldRelativePath: string; newRelativePath: string }>();
    const targetedResult = deferred<ArchiveEpubScan>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "move_archive_epub_file") return moveResult.promise;
      if (command === "scan_archive_epub_paths") return targetedResult.promise;
      return undefined;
    });

    const move = storage.moveBookToFolder("book-1", "folder:DestA");
    const watcher = storage.applyArchiveWatcherChanges({
      changes: [{ kind: "modify", relativePaths: ["Source/Two.epub"] }],
    });
    await waitForCalls("move_archive_epub_file", 1);
    await waitForCalls("scan_archive_epub_paths", 1);
    moveResult.resolve({
      oldRelativePath: "Source/One.epub",
      newRelativePath: "DestA/One.epub",
    });
    targetedResult.resolve({
      books: [
        {
          ...archive.scan.books[1],
          size: 8_192,
          modifiedAt: 1_700_000_010_000,
          sourceMetadata: { identifier: "urn:book-2", title: "Two changed externally" },
        },
      ],
      missingRelativePaths: [],
      warnings: [],
    });
    await Promise.all([move, watcher]);

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      relativePath: "DestA/One.epub",
    });
    await expect(storage.getBook("book-2")).resolves.toMatchObject({
      relativePath: "Source/Two.epub",
      size: 8_192,
      sourceMetadata: { title: "Two changed externally" },
    });
    expect(invokeMock.mock.calls.some(([command]) => command === "scan_archive")).toBe(false);
  });

  it("applies a pending delta after an older full scan reaches reconciliation", async () => {
    const { archive, storage } = await loadedStorage();
    const scanResult = deferred<ArchiveScan>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return scanResult.promise;
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      if (command === "move_archive_epub_file") {
        return {
          oldRelativePath: "Source/One.epub",
          newRelativePath: "DestA/One.epub",
        };
      }
      return undefined;
    });

    const rescan = storage.rescan({ quiet: true });
    await waitForCalls("scan_archive", 1);
    const move = storage.moveBookToFolder("book-1", "folder:DestA");
    const changedScan = structuredClone(archive.scan);
    changedScan.books[1] = {
      ...changedScan.books[1],
      size: 8_192,
      modifiedAt: 1_700_000_010_000,
      sourceMetadata: { identifier: "urn:book-2", title: "Scanned change" },
    };
    scanResult.resolve(changedScan);
    await Promise.all([rescan, move]);

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      relativePath: "DestA/One.epub",
    });
    await expect(storage.getBook("book-2")).resolves.toMatchObject({
      size: 8_192,
      sourceMetadata: { title: "Scanned change" },
    });
  });

  it("commits a successful delta after an overlapping repair scan fails", async () => {
    const { storage } = await loadedStorage();
    const scanResult = deferred<ArchiveScan>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return scanResult.promise;
      if (command === "move_archive_epub_file") {
        return {
          oldRelativePath: "Source/One.epub",
          newRelativePath: "DestA/One.epub",
        };
      }
      return undefined;
    });

    const rescan = storage.rescan({ quiet: true });
    const rescanFailure = rescan.catch((error: unknown) => error);
    await waitForCalls("scan_archive", 1);
    const move = storage.moveBookToFolder("book-1", "folder:DestA");
    scanResult.reject(new Error("repair scan failed"));

    await expect(rescanFailure).resolves.toEqual(expect.any(Error));
    await expect(move).resolves.toMatchObject({ relativePath: "DestA/One.epub" });
    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      relativePath: "DestA/One.epub",
    });
  });

  it("preserves the same valid result when the full scan completes before the native delta", async () => {
    const { archive, storage } = await loadedStorage();
    const moveResult = deferred<{ oldRelativePath: string; newRelativePath: string }>();
    const changedScan = structuredClone(archive.scan);
    changedScan.books[1] = {
      ...changedScan.books[1],
      size: 8_192,
      modifiedAt: 1_700_000_010_000,
      sourceMetadata: { identifier: "urn:book-2", title: "Scanned change" },
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "move_archive_epub_file") return moveResult.promise;
      if (command === "scan_archive") return structuredClone(changedScan);
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      return undefined;
    });

    const move = storage.moveBookToFolder("book-1", "folder:DestA");
    await waitForCalls("move_archive_epub_file", 1);
    await storage.rescan({ quiet: true });
    moveResult.resolve({
      oldRelativePath: "Source/One.epub",
      newRelativePath: "DestA/One.epub",
    });
    await move;

    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      relativePath: "DestA/One.epub",
    });
    await expect(storage.getBook("book-2")).resolves.toMatchObject({
      size: 8_192,
      sourceMetadata: { title: "Scanned change" },
    });
  });

  it("bounds delta persistence recovery and never publishes the unpersisted model", async () => {
    const { storage } = await loadedStorage();
    const initial = storage.getLibrarySnapshot();
    const snapshots: (typeof initial)[] = [];
    const stop = storage.observeLibrarySnapshot({
      next: (snapshot) => {
        if (snapshot !== initial) snapshots.push(snapshot);
      },
    });
    let saveAttempts = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "move_archive_epub_file") {
        return {
          oldRelativePath: "Source/One.epub",
          newRelativePath: "DestA/One.epub",
        };
      }
      if (command === "save_library_metadata") {
        saveAttempts += 1;
        throw new Error("disk unavailable");
      }
      return undefined;
    });

    const move = storage.moveBookToFolder("book-1", "folder:DestA");

    await expect(move).rejects.toMatchObject({
      name: "ArchiveDeltaPersistenceError",
    });
    expect(saveAttempts).toBe(2);
    expect(snapshots).toEqual([]);
    expect(storage.getLibrarySnapshot()).toBe(initial);
    await expect(storage.getBook("book-1")).resolves.toMatchObject({
      relativePath: "Source/One.epub",
    });
    stop();
  });

  it("discards queued Archive A commits before they can affect Archive B", async () => {
    const { storage } = await loadedStorage();
    const firstSaveStarted = deferred<void>();
    const releaseFirstSave = deferred<void>();
    let saveCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      const commandArgs = args as Record<string, unknown>;
      if (command === "move_archive_epub_file") {
        const relativePath = String(commandArgs.relativePath);
        return {
          oldRelativePath: relativePath,
          newRelativePath: relativePath === "Source/One.epub" ? "DestA/One.epub" : "DestB/Two.epub",
        };
      }
      if (command === "save_library_metadata") {
        saveCount += 1;
        if (saveCount === 1) {
          firstSaveStarted.resolve();
          await releaseFirstSave.promise;
        }
      }
      if (command === "scan_archive") return { books: [], folders: [], warnings: [] };
      if (command === "load_archive_metadata") {
        return {
          library: { version: 1, books: {} },
          progress: { version: 1, progress: {} },
          settings: { version: 1 },
        };
      }
      return undefined;
    });

    const firstMove = storage.moveBookToFolder("book-1", "folder:DestA");
    const secondMove = storage.moveBookToFolder("book-2", "folder:DestB");
    await firstSaveStarted.promise;
    storage.reset("C:/ArchiveB");
    releaseFirstSave.resolve();
    const settled = await Promise.allSettled([firstMove, secondMove]);

    expect(settled.every((result) => result.status === "rejected")).toBe(true);
    expect(
      invokeMock.mock.calls.filter(
        ([command, args]) =>
          command === "save_library_metadata" &&
          (args as { rootPath?: string } | undefined)?.rootPath === "C:/ArchiveB",
      ),
    ).toHaveLength(0);
    await expect(storage.listBooks()).resolves.toEqual([]);
  });
});
