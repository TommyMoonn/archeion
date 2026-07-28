import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type { ArchiveImportSettings } from "../../types/settings";

export type ArchiveBooksLoadState =
  | {
      status: "loading";
      archiveId: string;
      books: readonly LibrarySnapshotBook[] | undefined;
    }
  | { status: "ready"; archiveId: string; books: readonly LibrarySnapshotBook[] }
  | {
      status: "error";
      archiveId: string;
      books: readonly LibrarySnapshotBook[] | undefined;
    };

type UseLibraryWorkspaceDataInput = {
  archiveId: string;
  archiveRootPath: string;
  storage: LibraryStorage;
  watcherError: string | null;
  onArchiveLoadError: () => void;
  onWatcherError: (message: string) => void;
};

export function useLibraryWorkspaceData({
  archiveId,
  archiveRootPath,
  storage,
  watcherError,
  onArchiveLoadError,
  onWatcherError,
}: UseLibraryWorkspaceDataInput) {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      storage.observeLibrarySnapshot({
        next: onStoreChange,
      }),
    [storage],
  );
  const getSnapshot = useCallback(() => storage.getLibrarySnapshot(), [storage]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const snapshotMatchesArchive = snapshot.archiveRootPath === archiveRootPath;
  const books = snapshotMatchesArchive ? snapshot.books : undefined;
  const folders = snapshotMatchesArchive ? snapshot.folders : undefined;
  const booksLoadState = useMemo<ArchiveBooksLoadState>(() => {
    if (!snapshotMatchesArchive) {
      return { status: "loading", archiveId, books: undefined };
    }
    if (snapshot.loadState === "error") {
      return { status: "error", archiveId, books };
    }
    if (snapshot.loadState === "loading") {
      return { status: "loading", archiveId, books };
    }
    return { status: "ready", archiveId, books: books ?? [] };
  }, [archiveId, books, snapshot.loadState, snapshotMatchesArchive]);
  const [archiveImportSettings, setArchiveImportSettings] = useState<ArchiveImportSettings>(
    defaultArchiveImportSettings,
  );

  useEffect(() => {
    if (
      snapshotMatchesArchive &&
      snapshot.loadState === "loading" &&
      snapshot.scanStatus.status === "idle"
    ) {
      void Promise.resolve(storage.rescan()).catch(() => undefined);
    }
  }, [snapshot.loadState, snapshot.scanStatus.status, snapshotMatchesArchive, storage]);

  useEffect(() => {
    if (snapshotMatchesArchive && snapshot.loadState === "error") {
      onArchiveLoadError();
    }
  }, [onArchiveLoadError, snapshot.loadState, snapshotMatchesArchive]);

  useEffect(() => {
    if (watcherError) {
      onWatcherError(watcherError);
    }
  }, [onWatcherError, watcherError]);

  useEffect(() => {
    let cancelled = false;

    void storage
      .getArchiveImportSettings()
      .then((loadedImportSettings) => {
        if (!cancelled) setArchiveImportSettings(loadedImportSettings);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [storage]);

  return {
    archiveImportSettings,
    books,
    booksLoadState,
    folders,
    libraryArchiveGeneration: snapshotMatchesArchive ? snapshot.archiveGeneration : undefined,
    libraryRevision: snapshotMatchesArchive ? snapshot.revision : undefined,
  };
}
