// @vitest-environment happy-dom

import { act, useCallback, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage, ScanStatus, StorageObserver } from "../../storage/LibraryStorage";
import {
  deferred,
  firstScan,
  invokeMock,
  metadata,
  setupDefaultStorageMock,
} from "../../storage/tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "../../storage/TauriArchiveLibraryStorage";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type { ArchiveImportSettings } from "../../types/settings";
import { createStorage } from "./LibraryPage.testUtils";
import { useLibraryWorkspaceData, type ArchiveBooksLoadState } from "./useLibraryWorkspaceData";

type WorkspaceCommit = {
  bookRevision: number | null;
  folderRevision: number | null;
  status: ArchiveBooksLoadState["status"];
};

type Stream<T> = {
  emit: (value: T) => void;
  observe: (observer: StorageObserver<T>) => () => void;
  publications: () => number;
};

function controlledStream<T>(initial?: T): Stream<T> {
  let activeObserver: StorageObserver<T> | undefined;
  let publicationCount = 0;
  return {
    emit(value) {
      publicationCount += 1;
      activeObserver?.next(value);
    },
    observe(observer) {
      activeObserver = observer;
      if (initial !== undefined) observer.next(initial);
      return () => {
        if (activeObserver === observer) activeObserver = undefined;
      };
    },
    publications: () => publicationCount,
  };
}

function revisionBook(revision: number): Book {
  return {
    id: "book",
    fileName: "Book.epub",
    originalTitle: `Book revision ${revision}`,
    isFavorite: false,
    addedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

function revisionFolder(revision: number): Folder {
  return {
    id: "folder",
    name: `Folder revision ${revision}`,
    parentId: null,
    relativePath: "Folder",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

function revisionFrom(value: string | undefined): number | null {
  if (!value) return null;
  const match = /revision (\d+)$/.exec(value);
  return match ? Number(match[1]) : null;
}

function WorkspaceProbe({
  onCommit,
  storage,
}: {
  onCommit: (commit: WorkspaceCommit) => void;
  storage: LibraryStorage;
}) {
  const handleArchiveLoadError = useCallback(() => undefined, []);
  const handleWatcherError = useCallback(() => undefined, []);
  const state = useLibraryWorkspaceData({
    archiveId: "archive",
    storage,
    watcherError: null,
    onArchiveLoadError: handleArchiveLoadError,
    onWatcherError: handleWatcherError,
  });

  useLayoutEffect(() => {
    onCommit({
      bookRevision: revisionFrom(state.books?.[0]?.originalTitle),
      folderRevision: revisionFrom(state.folders?.[0]?.name),
      status: state.booksLoadState.status,
    });
  });

  return null;
}

type ProductionWorkspaceCommit = {
  bookFolderPath: string | null;
  hasReplacementFolder: boolean;
  status: ArchiveBooksLoadState["status"];
};

function ProductionWorkspaceProbe({
  onCommit,
  storage,
}: {
  onCommit: (commit: ProductionWorkspaceCommit) => void;
  storage: LibraryStorage;
}) {
  const handleArchiveLoadError = useCallback(() => undefined, []);
  const handleWatcherError = useCallback(() => undefined, []);
  const state = useLibraryWorkspaceData({
    archiveId: "archive",
    storage,
    watcherError: null,
    onArchiveLoadError: handleArchiveLoadError,
    onWatcherError: handleWatcherError,
  });

  useLayoutEffect(() => {
    onCommit({
      bookFolderPath: state.books?.[0]?.folderPath ?? null,
      hasReplacementFolder:
        state.folders?.some((folder) => folder.relativePath === "Replacement") ?? false,
      status: state.booksLoadState.status,
    });
  });

  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(setupDefaultStorageMock);

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("library publication performance evidence", () => {
  it("records production full-scan start and completion commits across natural async boundaries", async () => {
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/Archive");
    await storage.listBooks();
    const bookPublications: Book[][] = [];
    const folderPublications: Folder[][] = [];
    const statusPublications: ScanStatus["status"][] = [];
    const stopBooks = storage.observeBooks({
      next: (books) => bookPublications.push(books),
    });
    const stopFolders = storage.observeFolders({
      next: (folders) => folderPublications.push(folders),
    });
    const stopStatus = storage.observeScanStatus({
      next: (status) => statusPublications.push(status.status),
    });
    const commits: ProductionWorkspaceCommit[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ProductionWorkspaceProbe storage={storage} onCommit={(commit) => commits.push(commit)} />,
      );
    });
    await act(async () => Promise.resolve());
    commits.length = 0;
    bookPublications.length = 0;
    folderPublications.length = 0;
    statusPublications.length = 0;

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
    const scanResponse = deferred<typeof changedScan>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return scanResponse.promise;
      if (command === "load_archive_metadata") return structuredClone(metadata);
      return undefined;
    });

    let rescanPromise: Promise<void> | undefined;
    await act(async () => {
      rescanPromise = storage.rescan();
      await Promise.resolve();
    });

    const scanStartCommits = commits.splice(0);
    expect(scanStartCommits).toEqual([
      {
        bookFolderPath: "Author/Series",
        hasReplacementFolder: false,
        status: "loading",
      },
    ]);
    expect(bookPublications).toHaveLength(0);
    expect(folderPublications).toHaveLength(0);
    expect(statusPublications).toEqual(["scanning"]);

    await act(async () => {
      scanResponse.resolve(changedScan);
      await rescanPromise;
    });

    const completionCommits = commits.splice(0);
    expect(bookPublications).toHaveLength(1);
    expect(folderPublications).toHaveLength(1);
    expect(statusPublications).toEqual(["scanning", "idle"]);
    expect(completionCommits).toEqual([
      {
        bookFolderPath: "Replacement",
        hasReplacementFolder: true,
        status: "ready",
      },
    ]);
    expect(
      completionCommits.some(
        (commit) => (commit.bookFolderPath === "Replacement") !== commit.hasReplacementFolder,
      ),
    ).toBe(false);

    stopBooks();
    stopFolders();
    stopStatus();
  });

  it("demonstrates susceptibility when the three production streams arrive in separate React turns", async () => {
    const books = controlledStream<Book[]>();
    const folders = controlledStream<Folder[]>();
    const scanStatus = controlledStream<ScanStatus>({ status: "idle" });
    const storage = createStorage({
      observeBooks: books.observe,
      observeFolders: folders.observe,
      observeScanStatus: scanStatus.observe,
    });
    storage.getArchiveImportSettings = vi.fn<() => Promise<ArchiveImportSettings>>(
      () => new Promise<ArchiveImportSettings>(() => undefined),
    );
    const commits: WorkspaceCommit[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkspaceProbe storage={storage} onCommit={(commit) => commits.push(commit)} />,
      );
    });
    await act(async () => books.emit([revisionBook(1)]));
    await act(async () => folders.emit([revisionFolder(1)]));
    await act(async () => scanStatus.emit({ status: "idle" }));
    commits.length = 0;
    const bookPublicationsBefore = books.publications();
    const folderPublicationsBefore = folders.publications();
    const statusPublicationsBefore = scanStatus.publications();

    await act(async () =>
      scanStatus.emit({ status: "scanning", startedAt: "2026-07-24T00:00:00.000Z" }),
    );
    await act(async () => books.emit([revisionBook(2)]));
    await act(async () => folders.emit([revisionFolder(2)]));
    await act(async () => scanStatus.emit({ status: "idle" }));

    expect(books.publications() - bookPublicationsBefore).toBe(1);
    expect(folders.publications() - folderPublicationsBefore).toBe(1);
    expect(scanStatus.publications() - statusPublicationsBefore).toBe(2);
    expect(commits).toHaveLength(4);
    expect(commits).toContainEqual({
      bookRevision: 2,
      folderRevision: 1,
      status: "loading",
    });
    expect(commits.at(-1)).toEqual({
      bookRevision: 2,
      folderRevision: 2,
      status: "ready",
    });
  });

  it("records one React update for one Book-only or Folder-only publication", async () => {
    const books = controlledStream<Book[]>();
    const folders = controlledStream<Folder[]>();
    const scanStatus = controlledStream<ScanStatus>({ status: "idle" });
    const storage = createStorage({
      observeBooks: books.observe,
      observeFolders: folders.observe,
      observeScanStatus: scanStatus.observe,
    });
    storage.getArchiveImportSettings = vi.fn<() => Promise<ArchiveImportSettings>>(
      () => new Promise<ArchiveImportSettings>(() => undefined),
    );
    const commits: WorkspaceCommit[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkspaceProbe storage={storage} onCommit={(commit) => commits.push(commit)} />,
      );
    });
    await act(async () => books.emit([revisionBook(1)]));
    await act(async () => folders.emit([revisionFolder(1)]));
    commits.length = 0;

    await act(async () => books.emit([revisionBook(2)]));
    expect(commits).toEqual([
      {
        bookRevision: 2,
        folderRevision: 1,
        status: "ready",
      },
    ]);

    commits.length = 0;
    await act(async () => folders.emit([revisionFolder(2)]));
    expect(commits).toEqual([
      {
        bookRevision: 2,
        folderRevision: 2,
        status: "ready",
      },
    ]);
  });
});
