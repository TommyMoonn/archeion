import { useEffect, useState } from "react";

import type { LibraryStorage, ScanStatus } from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type { ArchiveImportSettings } from "../../types/settings";

export type ArchiveBooksLoadState =
  | { status: "loading"; archiveId: string; books: Book[] | undefined }
  | { status: "ready"; archiveId: string; books: Book[] }
  | { status: "error"; archiveId: string; books: Book[] | undefined };

type UseLibraryWorkspaceDataInput = {
  archiveId: string;
  storage: LibraryStorage;
  watcherError: string | null;
  onArchiveLoadError: () => void;
  onWatcherError: (message: string) => void;
};

export function useLibraryWorkspaceData({
  archiveId,
  storage,
  watcherError,
  onArchiveLoadError,
  onWatcherError,
}: UseLibraryWorkspaceDataInput) {
  const [booksLoadState, setBooksLoadState] = useState<ArchiveBooksLoadState>({
    status: "loading",
    archiveId,
    books: undefined,
  });
  const [folders, setFolders] = useState<Folder[] | undefined>();
  const [archiveImportSettings, setArchiveImportSettings] = useState<ArchiveImportSettings>(
    defaultArchiveImportSettings,
  );

  useEffect(() => {
    let active = true;
    let currentScanStatus: ScanStatus["status"] = "idle";
    let pendingBooks: Book[] | undefined;
    let booksLoadFailed = false;

    const publishReadyBooks = () => {
      if (
        !active ||
        currentScanStatus !== "idle" ||
        booksLoadFailed ||
        pendingBooks === undefined
      ) {
        return;
      }

      setBooksLoadState({ status: "ready", archiveId, books: pendingBooks });
    };
    const handleLoadError = () => {
      if (!active) return;
      booksLoadFailed = true;
      onArchiveLoadError();
    };
    const stopScanStatus = storage.observeScanStatus({
      next: (status) => {
        if (!active) return;

        currentScanStatus = status.status;
        if (status.status === "scanning") {
          booksLoadFailed = false;
          setBooksLoadState((currentState) => ({
            status: "loading",
            archiveId,
            books: currentState.archiveId === archiveId ? currentState.books : undefined,
          }));
          return;
        }

        publishReadyBooks();
      },
      error: () => {
        if (!active) return;
        handleLoadError();
        setBooksLoadState((currentState) => ({
          status: "error",
          archiveId,
          books: currentState.archiveId === archiveId ? currentState.books : undefined,
        }));
      },
    });
    const stopBooks = storage.observeBooks({
      next: (nextBooks) => {
        if (!active) return;

        pendingBooks = nextBooks;
        booksLoadFailed = false;
        setBooksLoadState({
          status: currentScanStatus === "idle" ? "ready" : "loading",
          archiveId,
          books: nextBooks,
        });
      },
      error: () => {
        if (!active) return;
        handleLoadError();
        setBooksLoadState((currentState) => ({
          status: "error",
          archiveId,
          books: currentState.archiveId === archiveId ? currentState.books : pendingBooks,
        }));
      },
    });
    const stopFolders = storage.observeFolders({
      next: (nextFolders) => {
        if (active) setFolders(nextFolders);
      },
      error: () => {
        if (active) onArchiveLoadError();
      },
    });

    return () => {
      active = false;
      stopScanStatus();
      stopBooks();
      stopFolders();
    };
  }, [archiveId, onArchiveLoadError, storage]);

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
    books: booksLoadState.books,
    booksLoadState,
    folders,
  };
}
