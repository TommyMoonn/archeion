import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { LibrarySnapshotBook, LibrarySnapshotFolder } from "../../storage/LibraryStorage";
import {
  focusElementIfRestorationOwned,
  focusIsUnowned,
  isUsableFocusTarget,
} from "../../utils/focusRestoration";
import {
  captureFolderDeletionFocusContext,
  findFolderDeletionFocusTarget,
  focusBelongsToDeletedFolder,
  type FolderDeletionFocusContext,
} from "../folders/folderMutationFocus";
import type { LibraryReturnFocusRequest } from "./useLibraryCollectionWindow";

type BookFocusContext = Readonly<{
  archiveId: string;
  bookId: string;
  index: number;
  locationKey: string;
  token: number;
}>;

export type BookMutationFocusClaim = Readonly<{
  bookId: string;
  token: number;
}>;

export type FolderDeletionFocusClaim = Readonly<{
  folderId: string;
  token: number;
}>;

type PendingBookFocus = BookFocusContext & Readonly<{ waitForRemoval: boolean }>;

type FolderFocusContext = Readonly<{
  archiveId: string;
  locationKey: string;
  context: FolderDeletionFocusContext;
  folderId: string;
  token: number;
}>;

type PendingFolderFocus = FolderFocusContext & Readonly<{ restoreLocationKey: string }>;

function folderDeletionLocationStillOwned(captured: string, current: string): boolean {
  return captured === current || (captured.startsWith("folder:") && current === "library");
}

type UseLibraryMutationFocusInput = {
  activeArchiveId: string;
  dialogOpen: boolean;
  fallbackRef: RefObject<HTMLElement | null>;
  folders: readonly LibrarySnapshotFolder[];
  locationKey: string;
  visibleBooks: readonly LibrarySnapshotBook[];
};

export function useLibraryMutationFocus({
  activeArchiveId,
  dialogOpen,
  fallbackRef,
  folders,
  locationKey,
  visibleBooks,
}: UseLibraryMutationFocusInput) {
  const visibleBooksRef = useRef(visibleBooks);
  const activeArchiveIdRef = useRef(activeArchiveId);
  const locationKeyRef = useRef(locationKey);
  const tokenRef = useRef(0);
  const capturedBookRef = useRef<BookFocusContext | null>(null);
  const capturedFolderRef = useRef<FolderFocusContext | null>(null);
  const [pendingBook, setPendingBook] = useState<PendingBookFocus | null>(null);
  const [pendingFolder, setPendingFolder] = useState<PendingFolderFocus | null>(null);

  useLayoutEffect(() => {
    visibleBooksRef.current = visibleBooks;
    activeArchiveIdRef.current = activeArchiveId;
    locationKeyRef.current = locationKey;
  }, [activeArchiveId, locationKey, visibleBooks]);

  const captureBook = useCallback(
    (book: LibrarySnapshotBook) => {
      const owner = document.activeElement?.closest<HTMLElement>("[data-reader-book-id]");
      if (owner?.dataset.readerBookId !== book.id) {
        capturedBookRef.current = null;
        return;
      }
      const index = visibleBooksRef.current.findIndex((candidate) => candidate.id === book.id);
      if (index < 0) {
        capturedBookRef.current = null;
        return;
      }
      capturedBookRef.current = {
        archiveId: activeArchiveId,
        bookId: book.id,
        index,
        locationKey,
        token: ++tokenRef.current,
      };
    },
    [activeArchiveId, locationKey],
  );

  const beginBookMutation = useCallback((bookId: string): BookMutationFocusClaim | null => {
    const captured = capturedBookRef.current;
    if (
      !captured ||
      captured.bookId !== bookId ||
      captured.archiveId !== activeArchiveIdRef.current ||
      captured.locationKey !== locationKeyRef.current
    ) {
      return null;
    }
    return { bookId, token: captured.token };
  }, []);

  const completeBookMutation = useCallback(
    (claim: BookMutationFocusClaim | null, outcome: "deleted" | "updated") => {
      if (!claim) return;
      const captured = capturedBookRef.current;
      if (
        !captured ||
        captured.bookId !== claim.bookId ||
        captured.token !== claim.token ||
        captured.archiveId !== activeArchiveIdRef.current ||
        captured.locationKey !== locationKeyRef.current
      ) {
        return;
      }
      setPendingBook({ ...captured, waitForRemoval: outcome === "deleted" });
    },
    [],
  );

  const captureFolderDeletion = useCallback(
    (folder: LibrarySnapshotFolder) => {
      const context = captureFolderDeletionFocusContext(document.activeElement, folder);
      capturedFolderRef.current = context
        ? {
            archiveId: activeArchiveId,
            context,
            folderId: folder.id,
            locationKey,
            token: ++tokenRef.current,
          }
        : null;
    },
    [activeArchiveId, locationKey],
  );

  const beginFolderDeletion = useCallback((folderId: string): FolderDeletionFocusClaim | null => {
    const captured = capturedFolderRef.current;
    if (
      !captured ||
      captured.folderId !== folderId ||
      captured.archiveId !== activeArchiveIdRef.current ||
      captured.locationKey !== locationKeyRef.current
    ) {
      return null;
    }
    return { folderId, token: captured.token };
  }, []);

  const completeFolderDeletion = useCallback(
    (claim: FolderDeletionFocusClaim | null, restoreLocationKey?: string) => {
      if (!claim) return;
      const captured = capturedFolderRef.current;
      const currentLocationKey = locationKeyRef.current;
      const locationStillOwned =
        captured?.locationKey === currentLocationKey ||
        (restoreLocationKey === currentLocationKey &&
          folderDeletionLocationStillOwned(captured?.locationKey ?? "", currentLocationKey));
      if (
        !captured ||
        captured.folderId !== claim.folderId ||
        captured.token !== claim.token ||
        captured.archiveId !== activeArchiveIdRef.current ||
        !locationStillOwned
      ) {
        return;
      }
      capturedFolderRef.current = null;
      setPendingFolder({
        ...captured,
        restoreLocationKey: restoreLocationKey ?? captured.locationKey,
      });
    },
    [],
  );

  useEffect(() => {
    if (
      !pendingFolder ||
      dialogOpen ||
      pendingFolder.archiveId !== activeArchiveId ||
      pendingFolder.restoreLocationKey !== locationKey
    ) {
      return;
    }
    if (!folderDeletionLocationStillOwned(pendingFolder.locationKey, locationKey)) {
      const frame = window.requestAnimationFrame(() => {
        setPendingFolder((current) => (current?.token === pendingFolder.token ? null : current));
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const routeChangedForDeletion = pendingFolder.locationKey !== locationKey;
    if (
      !routeChangedForDeletion &&
      folders.some((folder) => folder.id === pendingFolder.folderId)
    ) {
      return;
    }

    let confirmationFrame: number | null = null;
    const restoreFolderFocus = (current: PendingFolderFocus) => {
      if (
        focusIsUnowned() ||
        focusBelongsToDeletedFolder(document.activeElement, current.context)
      ) {
        if (
          !focusElementIfRestorationOwned(
            findFolderDeletionFocusTarget(document, current.context),
            { requestIsCurrent: () => pendingFolder?.token === current.token },
          )
        ) {
          focusElementIfRestorationOwned(fallbackRef.current, {
            requestIsCurrent: () => pendingFolder?.token === current.token,
          });
        }
      }
    };
    const frame = window.requestAnimationFrame(() => {
      setPendingFolder((current) => {
        if (!current || current.token !== pendingFolder.token) return current;
        restoreFolderFocus(current);
        confirmationFrame = window.requestAnimationFrame(() => {
          setPendingFolder((latest) => {
            if (!latest || latest.token !== pendingFolder.token) return latest;
            restoreFolderFocus(latest);
            return null;
          });
        });
        return current;
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (confirmationFrame !== null) window.cancelAnimationFrame(confirmationFrame);
    };
  }, [activeArchiveId, dialogOpen, fallbackRef, folders, locationKey, pendingFolder]);

  useEffect(() => {
    capturedBookRef.current = null;
    const frame = window.requestAnimationFrame(() => setPendingBook(null));
    return () => window.cancelAnimationFrame(frame);
  }, [locationKey]);

  useEffect(() => {
    capturedBookRef.current = null;
    capturedFolderRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      setPendingBook(null);
      setPendingFolder(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeArchiveId]);

  const pendingBookTarget = useMemo(() => {
    if (
      !pendingBook ||
      dialogOpen ||
      pendingBook.archiveId !== activeArchiveId ||
      pendingBook.locationKey !== locationKey
    ) {
      return null;
    }
    const sameBookIndex = visibleBooks.findIndex((book) => book.id === pendingBook.bookId);
    if (pendingBook.waitForRemoval && sameBookIndex >= 0) return null;
    if (visibleBooks.length === 0) return { fallback: true as const };
    const index =
      sameBookIndex >= 0 ? sameBookIndex : Math.min(pendingBook.index, visibleBooks.length - 1);
    const book = visibleBooks[index];
    return book ? { book, index, fallback: false as const } : { fallback: true as const };
  }, [activeArchiveId, dialogOpen, locationKey, pendingBook, visibleBooks]);

  useEffect(() => {
    if (!pendingBookTarget?.fallback || !pendingBook) return;
    const frame = window.requestAnimationFrame(() => {
      setPendingBook((current) => {
        if (!current || current.token !== pendingBook.token) return current;
        if (focusIsUnowned()) {
          focusElementIfRestorationOwned(fallbackRef.current, {
            requestIsCurrent: () => pendingBook?.token === current.token,
          });
        }
        return null;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fallbackRef, pendingBook, pendingBookTarget]);

  const collectionRequest = useMemo<LibraryReturnFocusRequest | null>(() => {
    if (!pendingBook || !pendingBookTarget || pendingBookTarget.fallback) return null;
    const { book, index } = pendingBookTarget;
    return {
      bookId: book.id,
      index,
      onTargetReady: (bookId, targetIndex, target) => {
        setPendingBook((current) => {
          if (
            !current ||
            current.token !== pendingBook.token ||
            bookId !== book.id ||
            targetIndex !== index ||
            !isUsableFocusTarget(target)
          ) {
            return current;
          }
          if (focusIsUnowned()) {
            focusElementIfRestorationOwned(target, {
              requestIsCurrent: () => pendingBook?.token === current.token,
            });
          }
          return null;
        });
      },
    };
  }, [pendingBook, pendingBookTarget]);

  return {
    beginBookMutation,
    beginFolderDeletion,
    captureBook,
    captureFolderDeletion,
    collectionRequest,
    completeBookMutation,
    completeFolderDeletion,
  };
}
