// @vitest-environment happy-dom

import { act, useCallback, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LibrarySnapshot,
  LibraryStorage,
  StorageObserver,
} from "../../storage/LibraryStorage";
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
import { createStorage } from "./LibraryPage.testUtils";
import { useLibraryWorkspaceData, type ArchiveBooksLoadState } from "./useLibraryWorkspaceData";

type WorkspaceCommit = {
  bookRevision: number | null;
  folderRevision: number | null;
  libraryArchiveGeneration: number | undefined;
  libraryRevision: number | undefined;
  status: ArchiveBooksLoadState["status"];
};

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

function WorkspaceProbe({
  archiveRootPath,
  onCommit,
  storage,
}: {
  archiveRootPath: string;
  onCommit: (commit: WorkspaceCommit) => void;
  storage: LibraryStorage;
}) {
  const handleArchiveLoadError = useCallback(() => undefined, []);
  const handleWatcherError = useCallback(() => undefined, []);
  const state = useLibraryWorkspaceData({
    archiveId: "archive",
    archiveRootPath,
    storage,
    watcherError: null,
    onArchiveLoadError: handleArchiveLoadError,
    onWatcherError: handleWatcherError,
  });

  useLayoutEffect(() => {
    onCommit({
      bookRevision: revisionFrom(state.books?.[0]?.originalTitle),
      folderRevision: revisionFrom(state.folders?.[0]?.name),
      libraryArchiveGeneration: state.libraryArchiveGeneration,
      libraryRevision: state.libraryRevision,
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
    archiveRootPath: "C:/Archive",
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

function controlledSnapshot(initial: LibrarySnapshot) {
  let snapshot = initial;
  let observer: StorageObserver<LibrarySnapshot> | undefined;
  return {
    emit(next: LibrarySnapshot) {
      snapshot = next;
      observer?.next(snapshot);
    },
    get: vi.fn(() => snapshot),
    observe: vi.fn((nextObserver: StorageObserver<LibrarySnapshot>) => {
      observer = nextObserver;
      return () => {
        if (observer === nextObserver) observer = undefined;
      };
    }),
  };
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

describe("library snapshot publication", () => {
  it("renders one loading boundary and one coherent completion for a production full scan", async () => {
    const storage = new TauriArchiveLibraryStorage();
    storage.reset("C:/Archive");
    await storage.listBooks();
    const initialRevision = storage.getLibrarySnapshot().revision;
    const snapshots: LibrarySnapshot[] = [];
    const stop = storage.observeLibrarySnapshot({
      next: (snapshot) => snapshots.push(snapshot),
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
    commits.length = 0;
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

    expect(commits.splice(0)).toEqual([
      {
        bookFolderPath: "Author/Series",
        hasReplacementFolder: false,
        status: "loading",
      },
    ]);

    await act(async () => {
      scanResponse.resolve(changedScan);
      await rescanPromise;
    });

    const completionCommits = commits.splice(0);
    const modelSnapshots = modelRevisionTransitions(snapshots, initialRevision);
    expect(modelSnapshots).toHaveLength(1);
    expect(modelSnapshots[0]?.books[0]?.folderPath).toBe("Replacement");
    expect(modelSnapshots[0]?.folders.some((folder) => folder.relativePath === "Replacement")).toBe(
      true,
    );
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
    stop();
  });

  it("uses one subscription and cannot render mixed Book and Folder snapshot revisions", async () => {
    const source = controlledSnapshot({
      archiveGeneration: 1,
      archiveRootPath: "C:/Archive",
      books: [revisionBook(1)],
      folders: [revisionFolder(1)],
      loadState: "ready",
      revision: 1,
      scanStatus: { status: "idle" },
    });
    const storage = createStorage({
      getLibrarySnapshot: source.get,
      observeLibrarySnapshot: source.observe,
    });
    const commits: WorkspaceCommit[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkspaceProbe
          archiveRootPath="C:/Archive"
          storage={storage}
          onCommit={(commit) => commits.push(commit)}
        />,
      );
    });
    commits.length = 0;

    await act(async () => {
      source.emit({
        ...source.get(),
        books: [revisionBook(2)],
        folders: [revisionFolder(2)],
        revision: 2,
      });
    });

    expect(source.observe).toHaveBeenCalledTimes(1);
    expect(commits).toEqual([
      {
        bookRevision: 2,
        folderRevision: 2,
        libraryArchiveGeneration: 1,
        libraryRevision: 2,
        status: "ready",
      },
    ]);
  });

  it("records one React update for one Book-only or Folder-only snapshot revision", async () => {
    const source = controlledSnapshot({
      archiveGeneration: 1,
      archiveRootPath: "C:/Archive",
      books: [revisionBook(1)],
      folders: [revisionFolder(1)],
      loadState: "ready",
      revision: 1,
      scanStatus: { status: "idle" },
    });
    const storage = createStorage({
      getLibrarySnapshot: source.get,
      observeLibrarySnapshot: source.observe,
    });
    const commits: WorkspaceCommit[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkspaceProbe
          archiveRootPath="C:/Archive"
          storage={storage}
          onCommit={(commit) => commits.push(commit)}
        />,
      );
    });
    commits.length = 0;

    await act(async () => {
      source.emit({
        ...source.get(),
        books: [revisionBook(2)],
        revision: 2,
      });
    });
    expect(commits).toEqual([
      {
        bookRevision: 2,
        folderRevision: 1,
        libraryArchiveGeneration: 1,
        libraryRevision: 2,
        status: "ready",
      },
    ]);

    commits.length = 0;
    await act(async () => {
      source.emit({
        ...source.get(),
        folders: [revisionFolder(2)],
        revision: 3,
      });
    });
    expect(commits).toEqual([
      {
        bookRevision: 2,
        folderRevision: 2,
        libraryArchiveGeneration: 1,
        libraryRevision: 3,
        status: "ready",
      },
    ]);
  });
});
