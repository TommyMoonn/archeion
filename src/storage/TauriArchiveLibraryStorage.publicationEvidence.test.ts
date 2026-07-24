import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../types/book";
import type { Folder } from "../types/folder";
import type { LibrarySnapshot } from "./LibraryStorage";
import {
  deferred,
  firstScan,
  invokeMock,
  metadata,
  setupDefaultStorageMock,
  twoBookArchive,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";

function acceptMutableBook(book: Book): void {
  void book;
}
function acceptMutableFolder(folder: Folder): void {
  void folder;
}

function assertReadonlySnapshotContract(snapshot: LibrarySnapshot): void {
  // @ts-expect-error Snapshot collections do not expose structural mutation.
  snapshot.books.push(snapshot.books[0]!);
  // @ts-expect-error Snapshot Book fields are read-only.
  snapshot.books[0]!.isFavorite = false;
  // @ts-expect-error Nested source metadata is read-only.
  snapshot.books[0]!.sourceMetadata!.title = "Changed";
  // @ts-expect-error Nested metadata arrays do not expose mutation.
  snapshot.books[0]!.sourceMetadata!.subjects!.push("Changed");
  // @ts-expect-error Snapshot Folder fields are read-only.
  snapshot.folders[0]!.name = "Changed";

  // @ts-expect-error Snapshot Book cannot widen to mutable Book.
  const mutableBook: Book = snapshot.books[0]!;
  // @ts-expect-error Snapshot Folder cannot widen to mutable Folder.
  const mutableFolder: Folder = snapshot.folders[0]!;
  // @ts-expect-error Mutable Book consumers cannot accept snapshot Books.
  acceptMutableBook(snapshot.books[0]!);
  // @ts-expect-error Mutable Folder consumers cannot accept snapshot Folders.
  acceptMutableFolder(snapshot.folders[0]!);

  void mutableBook;
  void mutableFolder;

  const mutableBookFixture: Book = {
    addedAt: "2026-07-24T00:00:00.000Z",
    fileName: "Mutable.epub",
    id: "mutable-book",
    isFavorite: false,
    originalTitle: "Mutable",
    sourceMetadata: { subjects: ["Fixture"] },
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
  const mutableFolderFixture: Folder = {
    createdAt: "2026-07-24T00:00:00.000Z",
    id: "mutable-folder",
    name: "Mutable",
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
  acceptMutableBook(mutableBookFixture);
  acceptMutableFolder(mutableFolderFixture);
  mutableBookFixture.sourceMetadata?.subjects?.push("Still mutable");
  mutableFolderFixture.name = "Still mutable";
}
void assertReadonlySnapshotContract;

describe("TauriArchiveLibraryStorage snapshot publication", () => {
  beforeEach(setupDefaultStorageMock);

  it("publishes one coherent model revision for one changed full scan", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const initial = storage.getLibrarySnapshot();
    const snapshots: LibrarySnapshot[] = [];
    const stop = storage.observeLibrarySnapshot({
      next: (snapshot) => snapshots.push(snapshot),
    });
    snapshots.length = 0;
    const changedScan = structuredClone(firstScan);
    changedScan.folders.push({
      id: "folder:Replacement",
      name: "Replacement",
      relativePath: "Replacement",
      parentPath: null,
    });
    changedScan.books[0] = {
      ...changedScan.books[0],
      relativePath: "Replacement/Volume_01.epub",
      folderPath: "Replacement",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(changedScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      return undefined;
    });

    await storage.rescan();

    const modelPublications = modelRevisionTransitions(snapshots, initial.revision);
    expect(modelPublications).toHaveLength(1);
    expect(modelPublications[0]).toMatchObject({
      archiveGeneration: initial.archiveGeneration,
      loadState: "ready",
      revision: initial.revision + 1,
      scanStatus: { status: "idle" },
    });
    expect(modelPublications[0]?.books[0]?.folderPath).toBe("Replacement");
    expect(modelPublications[0]?.folders.some((folder) => folder.name === "Replacement")).toBe(
      true,
    );
    expect(scanTransitions(snapshots)).toEqual(["scanning", "idle"]);
    stop();
  });

  it("replaces only the changed Book during a Book-only mutation", async () => {
    const archive = twoBookArchive("Author");
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(archive.scan);
      if (command === "load_archive_metadata") return structuredClone(archive.metadata);
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const initial = storage.getLibrarySnapshot();
    const snapshots: LibrarySnapshot[] = [];
    const stop = storage.observeLibrarySnapshot({
      next: (snapshot) => snapshots.push(snapshot),
    });
    snapshots.length = 0;

    await storage.updateBook("book-1", { isFavorite: false });

    const changed = snapshots[0];
    expect(snapshots).toHaveLength(1);
    expect(changed?.revision).toBe(initial.revision + 1);
    expect(changed?.books).not.toBe(initial.books);
    expect(changed?.books.find((book) => book.id === "book-1")).not.toBe(
      initial.books.find((book) => book.id === "book-1"),
    );
    expect(changed?.books.find((book) => book.id === "book-2")).toBe(
      initial.books.find((book) => book.id === "book-2"),
    );
    expect(changed?.folders).toBe(initial.folders);
    stop();
  });

  it("replaces only the changed Folder during a Folder-only mutation", async () => {
    const scan = structuredClone(firstScan);
    scan.folders.push({
      id: "folder:Other",
      name: "Other",
      relativePath: "Other",
      parentPath: null,
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(scan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      if (command === "rename_archive_folder") {
        return { oldRelativePath: "Other", newRelativePath: "Renamed" };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const initial = storage.getLibrarySnapshot();
    const snapshots: LibrarySnapshot[] = [];
    const stop = storage.observeLibrarySnapshot({
      next: (snapshot) => snapshots.push(snapshot),
    });
    snapshots.length = 0;

    await storage.updateFolder("folder:Other", { name: "Renamed" });

    const changed = snapshots[0];
    expect(snapshots).toHaveLength(1);
    expect(changed?.revision).toBe(initial.revision + 1);
    expect(changed?.books).toBe(initial.books);
    expect(changed?.folders).not.toBe(initial.folders);
    expect(changed?.folders.find((folder) => folder.id === "folder:Renamed")).toBeDefined();
    expect(changed?.folders.find((folder) => folder.id === "folder:Other")).toBeUndefined();
    for (const folderId of ["folder:Author", "folder:Author/Series"]) {
      expect(changed?.folders.find((folder) => folder.id === folderId)).toBe(
        initial.folders.find((folder) => folder.id === folderId),
      );
    }
    expect(Object.isFrozen(changed)).toBe(true);
    expect(Object.isFrozen(changed?.books)).toBe(true);
    expect(Object.isFrozen(changed?.folders)).toBe(true);
    expect(() => Array.prototype.push.call(changed?.books, changed?.books[0])).toThrow(TypeError);
    expect(() => Array.prototype.push.call(changed?.folders, changed?.folders[0])).toThrow(
      TypeError,
    );
    stop();
  });

  it("preserves collection and entry identity across status-only publications", async () => {
    const scan = deferred<typeof firstScan>();
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const readySnapshot = storage.getLibrarySnapshot();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return scan.promise;
      if (command === "load_archive_metadata") return structuredClone(metadata);
      return undefined;
    });

    const rescan = storage.rescan();
    await vi.waitFor(() => expect(storage.getLibrarySnapshot().scanStatus.status).toBe("scanning"));
    const scanningSnapshot = storage.getLibrarySnapshot();
    expect(scanningSnapshot.revision).toBe(readySnapshot.revision);
    expect(scanningSnapshot.books).toBe(readySnapshot.books);
    expect(scanningSnapshot.folders).toBe(readySnapshot.folders);
    expect(scanningSnapshot.books[0]).toBe(readySnapshot.books[0]);
    expect(scanningSnapshot.folders[0]).toBe(readySnapshot.folders[0]);

    scan.resolve(structuredClone(firstScan));
    await rescan;

    const completedSnapshot = storage.getLibrarySnapshot();
    expect(completedSnapshot.revision).toBe(readySnapshot.revision);
    expect(completedSnapshot.books).toBe(readySnapshot.books);
    expect(completedSnapshot.folders).toBe(readySnapshot.folders);
    expect(completedSnapshot.books[0]).toBe(readySnapshot.books[0]);
    expect(completedSnapshot.folders[0]).toBe(readySnapshot.folders[0]);
  });

  it("preserves the last ready model when a later scan fails", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const readySnapshot = storage.getLibrarySnapshot();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") throw new Error("scan failed");
      if (command === "load_archive_metadata") return structuredClone(metadata);
      return undefined;
    });

    await expect(storage.rescan()).rejects.toThrow("scan failed");

    const failedSnapshot = storage.getLibrarySnapshot();
    expect(failedSnapshot).toMatchObject({
      loadState: "error",
      revision: readySnapshot.revision,
      scanStatus: { status: "idle" },
    });
    expect(failedSnapshot.books).toBe(readySnapshot.books);
    expect(failedSnapshot.folders).toBe(readySnapshot.folders);
  });

  it("keeps the initial empty model revision and identities when the first scan fails", async () => {
    invokeMock.mockRejectedValue(new Error("initial scan failed"));
    const storage = new TauriArchiveLibraryStorage();
    const initialSnapshot = storage.getLibrarySnapshot();
    const snapshots: LibrarySnapshot[] = [];
    storage.observeLibrarySnapshot({ next: (snapshot) => snapshots.push(snapshot) });

    await expect(storage.rescan()).rejects.toThrow("initial scan failed");

    const failedSnapshot = storage.getLibrarySnapshot();
    expect(failedSnapshot).toMatchObject({
      books: [],
      folders: [],
      loadState: "error",
      revision: initialSnapshot.revision,
      scanStatus: { status: "idle" },
    });
    expect(failedSnapshot.books).toBe(initialSnapshot.books);
    expect(failedSnapshot.folders).toBe(initialSnapshot.folders);
    expect(new Set(snapshots.map((snapshot) => snapshot.revision))).toEqual(
      new Set([initialSnapshot.revision]),
    );
    expect(scanTransitions(snapshots)).toEqual(["idle", "scanning", "idle"]);
  });

  it("establishes one ready model revision when an empty retry succeeds", async () => {
    invokeMock.mockRejectedValue(new Error("initial scan failed"));
    const storage = new TauriArchiveLibraryStorage();
    const initialSnapshot = storage.getLibrarySnapshot();
    await expect(storage.rescan()).rejects.toThrow("initial scan failed");
    const failedSnapshot = storage.getLibrarySnapshot();
    const snapshots: LibrarySnapshot[] = [];
    storage.observeLibrarySnapshot({ next: (snapshot) => snapshots.push(snapshot) });
    snapshots.length = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return { books: [], folders: [] };
      if (command === "load_archive_metadata") {
        const emptyMetadata = structuredClone(metadata);
        return {
          ...emptyMetadata,
          library: {
            ...emptyMetadata.library,
            books: {},
          },
        };
      }
      return undefined;
    });

    await storage.rescan();

    const readySnapshot = storage.getLibrarySnapshot();
    expect(failedSnapshot.revision).toBe(initialSnapshot.revision);
    expect(readySnapshot).toMatchObject({
      books: [],
      folders: [],
      loadState: "ready",
      revision: initialSnapshot.revision + 1,
      scanStatus: { status: "idle" },
    });
    expect(modelRevisionTransitions(snapshots, initialSnapshot.revision)).toHaveLength(1);
  });

  it("does not let an old archive generation publish after reset", async () => {
    const scan = deferred<typeof firstScan>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return scan.promise;
      if (command === "load_archive_metadata") return structuredClone(metadata);
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/ArchiveA");
    const staleScan = storage.rescan();
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("scan_archive", {
        rootPath: "C:/ArchiveA",
      }),
    );

    storage.reset("C:/ArchiveB");
    const replacementSnapshot = storage.getLibrarySnapshot();
    scan.resolve(structuredClone(firstScan));
    await staleScan;

    expect(storage.getLibrarySnapshot()).toBe(replacementSnapshot);
    expect(replacementSnapshot).toMatchObject({
      archiveRootPath: "C:/ArchiveB",
      books: [],
      folders: [],
      loadState: "loading",
    });
  });
});

function scanTransitions(snapshots: readonly LibrarySnapshot[]): string[] {
  const transitions: string[] = [];
  for (const snapshot of snapshots) {
    if (transitions.at(-1) !== snapshot.scanStatus.status) {
      transitions.push(snapshot.scanStatus.status);
    }
  }
  return transitions;
}

function modelRevisionTransitions(
  snapshots: readonly LibrarySnapshot[],
  initialRevision: number,
): LibrarySnapshot[] {
  let previousRevision = initialRevision;
  return snapshots.filter((snapshot) => {
    if (snapshot.revision === previousRevision) return false;
    previousRevision = snapshot.revision;
    return true;
  });
}
