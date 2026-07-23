import { useCallback, useRef, useState } from "react";

import type { AddArchiveEpubInput } from "../../storage/LibraryStorage";
import type { LibraryStorage } from "../../storage/LibraryStorage";
import type {
  Book,
  EpubCoverFraming,
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
  EpubMetadataWritebackInput,
} from "../../types/book";
import type { Folder } from "../../types/folder";
import type { LibraryLocation } from "../../types/library";
import {
  releaseArchiveScanOperation,
  tryAcquireArchiveScanOperation,
  useArchiveScanActivity,
} from "../archive/useArchiveScanActivity";
import {
  shouldConfirmBookDeletion,
  shouldConfirmFolderDeletion,
} from "../filesystem/destructiveActionPolicy";
import {
  createDeleteErrorFeedbackToken,
  createDeleteSuccessFeedbackToken,
  createFolderSuccessFeedbackToken,
  createImportFeedbackToken,
  createMutationSuccessFeedbackToken,
  type LibraryFeedbackDraft,
} from "./libraryFeedback";
import { isInsideFolder } from "./libraryFolderRelations";
import type { LibraryWorkspaceDialogActions } from "./useLibraryWorkspaceDialogs";
import type { RunFolderPathMutation } from "./useFolderPathMutationContinuity";
import type { BookMutationFocusClaim, FolderDeletionFocusClaim } from "./useLibraryMutationFocus";
import type { LibraryFeedbackOperation } from "./useLibraryFeedback";

type UseLibraryBookActionsInput = {
  beginBookMutation: (bookId: string) => BookMutationFocusClaim | null;
  beginFolderDeletion: (folderId: string) => FolderDeletionFocusClaim | null;
  beginFeedbackOperation: (owner: string) => LibraryFeedbackOperation;
  changeLocation: (location: LibraryLocation) => void;
  confirmDestructiveFileActions: boolean;
  currentFolder: Folder | undefined;
  dialogs: LibraryWorkspaceDialogActions;
  dismissFeedback: (id: string) => void;
  location: LibraryLocation;
  onBookMutationComplete: (
    claim: BookMutationFocusClaim | null,
    outcome: "deleted" | "updated",
  ) => void;
  onFolderDeletionComplete: (
    claim: FolderDeletionFocusClaim | null,
    restoreLocationKey?: string,
  ) => void;
  publishFeedbackOperation: (
    operation: LibraryFeedbackOperation,
    feedback: LibraryFeedbackDraft,
  ) => boolean;
  runFolderPathMutation: RunFolderPathMutation;
  storage: LibraryStorage;
};

export function useLibraryBookActions({
  beginBookMutation,
  beginFolderDeletion,
  beginFeedbackOperation,
  changeLocation,
  confirmDestructiveFileActions,
  currentFolder,
  dialogs,
  dismissFeedback,
  location,
  onBookMutationComplete,
  onFolderDeletionComplete,
  publishFeedbackOperation,
  runFolderPathMutation,
  storage,
}: UseLibraryBookActionsInput) {
  const importLock = useRef(false);
  const deleteLock = useRef(false);
  const rescanLock = useRef(false);
  const archiveScanActive = useArchiveScanActivity(storage);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClearingProgress, setIsClearingProgress] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);

  const importEpubs = useCallback(
    async (input: AddArchiveEpubInput) => {
      if (importLock.current) return;

      importLock.current = true;
      setIsImporting(true);
      const feedbackOperation = beginFeedbackOperation("archive-import");
      dismissFeedback("archive-import");

      try {
        const results = await storage.addEpubFilesToArchive(input);
        const feedback = createImportFeedbackToken("archive-import", results);
        if (feedback) publishFeedbackOperation(feedbackOperation, feedback);
      } finally {
        importLock.current = false;
        setIsImporting(false);
      }
    },
    [beginFeedbackOperation, dismissFeedback, publishFeedbackOperation, storage],
  );

  const deleteBook = useCallback(
    async (book: Book) => {
      if (deleteLock.current) return;

      deleteLock.current = true;
      setIsDeleting(true);
      const feedbackId = `library-delete-book:${book.id}`;
      const feedbackOperation = beginFeedbackOperation(`delete-book:${book.id}`);
      dismissFeedback(feedbackId);
      const focusClaim = beginBookMutation(book.id);

      try {
        await storage.deleteBook(book.id);
        onBookMutationComplete(focusClaim, "deleted");
        publishFeedbackOperation(
          feedbackOperation,
          createDeleteSuccessFeedbackToken(
            book.isFileMissing ? "metadataRemoved" : "bookDeleted",
            feedbackId,
          ),
        );
      } catch {
        publishFeedbackOperation(
          feedbackOperation,
          createDeleteErrorFeedbackToken(
            book.isFileMissing ? "metadataRemoveFailed" : "bookDeleteFailed",
            feedbackId,
          ),
        );
      } finally {
        dialogs.close();
        deleteLock.current = false;
        setIsDeleting(false);
      }
    },
    [
      beginBookMutation,
      beginFeedbackOperation,
      dialogs,
      dismissFeedback,
      onBookMutationComplete,
      publishFeedbackOperation,
      storage,
    ],
  );

  const requestDeleteBook = useCallback(
    (book: Book) => {
      if (shouldConfirmBookDeletion(confirmDestructiveFileActions, Boolean(book.isFileMissing))) {
        dialogs.openDeleteBook(book);
      } else {
        dialogs.close();
        void deleteBook(book);
      }
    },
    [confirmDestructiveFileActions, deleteBook, dialogs],
  );

  const deleteFolder = useCallback(
    async (folder: Folder) => {
      if (deleteLock.current) return;

      deleteLock.current = true;
      setIsDeleting(true);
      const feedbackId = `library-delete-folder:${folder.id}`;
      const feedbackOperation = beginFeedbackOperation(`delete-folder:${folder.id}`);
      dismissFeedback(feedbackId);
      const focusClaim = beginFolderDeletion(folder.id);

      try {
        await storage.deleteFolder(folder.id);
        const returnsToLibrary =
          location.type === "folder" &&
          (location.folderId === folder.id || isInsideFolder(currentFolder?.relativePath, folder));
        onFolderDeletionComplete(focusClaim, returnsToLibrary ? "library" : undefined);
        if (returnsToLibrary) changeLocation({ type: "library" });
        publishFeedbackOperation(
          feedbackOperation,
          createDeleteSuccessFeedbackToken("folderDeleted", feedbackId),
        );
      } catch {
        publishFeedbackOperation(
          feedbackOperation,
          createDeleteErrorFeedbackToken("folderDeleteFailed", feedbackId),
        );
      } finally {
        dialogs.close();
        deleteLock.current = false;
        setIsDeleting(false);
      }
    },
    [
      beginFolderDeletion,
      beginFeedbackOperation,
      changeLocation,
      currentFolder,
      dialogs,
      dismissFeedback,
      location,
      onFolderDeletionComplete,
      publishFeedbackOperation,
      storage,
    ],
  );

  const requestDeleteFolder = useCallback(
    (folder: Folder) => {
      if (shouldConfirmFolderDeletion(confirmDestructiveFileActions)) {
        dialogs.openDeleteFolder(folder);
      } else {
        void deleteFolder(folder);
      }
    },
    [confirmDestructiveFileActions, deleteFolder, dialogs],
  );

  const confirmClearProgress = useCallback(
    async (book: Book) => {
      if (isClearingProgress) return;

      setIsClearingProgress(true);
      const feedbackOperation = beginFeedbackOperation("clear-progress");
      dismissFeedback("clear-progress");
      const focusClaim = beginBookMutation(book.id);
      try {
        const updated = await storage.updateBook(book.id, {
          progressCfi: undefined,
          progressPercent: 0,
        });
        if (!updated) {
          throw new Error("The active archive changed before progress was cleared.");
        }
        onBookMutationComplete(focusClaim, "updated");
        publishFeedbackOperation(feedbackOperation, {
          id: "clear-progress",
          tone: "success",
          title: "Reading progress cleared.",
          autoDismiss: true,
        });
      } catch {
        publishFeedbackOperation(feedbackOperation, {
          id: "clear-progress",
          tone: "error",
          title: "Reading progress could not be cleared.",
        });
      } finally {
        dialogs.openBookDetailsById(book.id);
        setIsClearingProgress(false);
      }
    },
    [
      beginBookMutation,
      beginFeedbackOperation,
      dialogs,
      dismissFeedback,
      isClearingProgress,
      onBookMutationComplete,
      publishFeedbackOperation,
      storage,
    ],
  );

  const rescanLibrary = useCallback(async () => {
    if (rescanLock.current) return;
    const scanClaim = tryAcquireArchiveScanOperation(storage);
    if (!scanClaim) return;

    rescanLock.current = true;
    setIsRescanning(true);
    const feedbackOperation = beginFeedbackOperation("manual-rescan");
    dismissFeedback("manual-rescan");
    try {
      await storage.rescan();
      publishFeedbackOperation(feedbackOperation, {
        autoDismiss: true,
        id: "manual-rescan",
        tone: "success",
        title: "Archive refreshed.",
      });
    } catch {
      publishFeedbackOperation(feedbackOperation, {
        id: "manual-rescan",
        tone: "error",
        title: "The archive could not be scanned.",
      });
    } finally {
      rescanLock.current = false;
      setIsRescanning(false);
      releaseArchiveScanOperation(scanClaim);
    }
  }, [beginFeedbackOperation, dismissFeedback, publishFeedbackOperation, storage]);

  const revealBookFile = useCallback(
    async (book: Book) => {
      if (!book.relativePath) return;
      const feedbackId = `library-reveal-book:${book.id}`;
      const feedbackOperation = beginFeedbackOperation(`reveal-book:${book.id}`);
      dismissFeedback(feedbackId);
      try {
        await storage.revealBookFile(book.id);
      } catch {
        publishFeedbackOperation(feedbackOperation, {
          id: feedbackId,
          tone: "error",
          title: "The EPUB could not be revealed in its folder.",
        });
      }
    },
    [beginFeedbackOperation, dismissFeedback, publishFeedbackOperation, storage],
  );

  const toggleFavorite = useCallback(
    async (book: Book) => {
      const feedbackId = `library-favorite:${book.id}`;
      const feedbackOperation = beginFeedbackOperation(`favorite:${book.id}`);
      dismissFeedback(feedbackId);
      const focusClaim = beginBookMutation(book.id);
      try {
        await storage.updateBook(book.id, { isFavorite: !book.isFavorite });
        onBookMutationComplete(focusClaim, "updated");
      } catch {
        publishFeedbackOperation(feedbackOperation, {
          id: feedbackId,
          tone: "error",
          title: "Favorite status could not be updated.",
        });
      }
    },
    [
      beginBookMutation,
      beginFeedbackOperation,
      dismissFeedback,
      onBookMutationComplete,
      publishFeedbackOperation,
      storage,
    ],
  );

  const writeBookMetadata = useCallback(
    async (book: Book, metadata: EpubMetadataWritebackInput) => {
      const focusClaim = beginBookMutation(book.id);
      const result = await storage.writeBookMetadata(book.id, metadata);
      onBookMutationComplete(focusClaim, "updated");
      return result;
    },
    [beginBookMutation, onBookMutationComplete, storage],
  );
  const prepareBookCover = useCallback(
    (book: Book, imagePath: string, framing: EpubCoverFraming): Promise<EpubCoverPreparation> =>
      storage.prepareBookCover(book.id, imagePath, framing),
    [storage],
  );
  const writeBookCover = useCallback(
    async (book: Book, input: EpubCoverWritebackInput): Promise<EpubCoverWritebackResult> => {
      const focusClaim = beginBookMutation(book.id);
      const result = await storage.writeBookCover(book.id, input);
      onBookMutationComplete(focusClaim, "updated");
      return result;
    },
    [beginBookMutation, onBookMutationComplete, storage],
  );

  const renameBookFile = useCallback(
    async (book: Book, fileName: string) => {
      const feedbackOperation = beginFeedbackOperation(`rename-book:${book.id}`);
      const focusClaim = beginBookMutation(book.id);
      await storage.renameBookFile(book.id, fileName);
      onBookMutationComplete(focusClaim, "updated");
      publishFeedbackOperation(
        feedbackOperation,
        createMutationSuccessFeedbackToken("bookRenamed"),
      );
    },
    [
      beginBookMutation,
      beginFeedbackOperation,
      onBookMutationComplete,
      publishFeedbackOperation,
      storage,
    ],
  );
  const moveBook = useCallback(
    async (book: Book, folderId: string | null) => {
      const feedbackOperation = beginFeedbackOperation(`move-book:${book.id}`);
      const focusClaim = beginBookMutation(book.id);
      await storage.moveBookToFolder(book.id, folderId);
      onBookMutationComplete(focusClaim, "updated");
      publishFeedbackOperation(feedbackOperation, createMutationSuccessFeedbackToken("bookMoved"));
    },
    [
      beginBookMutation,
      beginFeedbackOperation,
      onBookMutationComplete,
      publishFeedbackOperation,
      storage,
    ],
  );
  const createFolder = useCallback(
    async (name: string) => {
      const feedbackOperation = beginFeedbackOperation("create-folder");
      await storage.createFolder({
        name,
        parentId: location.type === "folder" ? location.folderId : null,
      });
      publishFeedbackOperation(feedbackOperation, createFolderSuccessFeedbackToken());
    },
    [beginFeedbackOperation, location, publishFeedbackOperation, storage],
  );
  const renameFolder = useCallback(
    async (folder: Folder, name: string) => {
      const feedbackOperation = beginFeedbackOperation(`rename-folder:${folder.id}`);
      await runFolderPathMutation(folder, { name }, () =>
        storage.updateFolder(folder.id, { name }),
      );
      publishFeedbackOperation(
        feedbackOperation,
        createMutationSuccessFeedbackToken("folderRenamed"),
      );
    },
    [beginFeedbackOperation, publishFeedbackOperation, runFolderPathMutation, storage],
  );
  const moveFolder = useCallback(
    async (folder: Folder, folderId: string | null) => {
      const feedbackOperation = beginFeedbackOperation(`move-folder:${folder.id}`);
      await runFolderPathMutation(folder, { parentId: folderId }, () =>
        storage.updateFolder(folder.id, { parentId: folderId }),
      );
      publishFeedbackOperation(
        feedbackOperation,
        createMutationSuccessFeedbackToken("folderMoved"),
      );
    },
    [beginFeedbackOperation, publishFeedbackOperation, runFolderPathMutation, storage],
  );
  const revealFolder = useCallback(
    async (folder: Folder) => {
      const feedbackId = `library-reveal-folder:${folder.id}`;
      const feedbackOperation = beginFeedbackOperation(`reveal-folder:${folder.id}`);
      dismissFeedback(feedbackId);
      try {
        await storage.revealFolder(folder.id);
      } catch {
        publishFeedbackOperation(feedbackOperation, {
          id: feedbackId,
          tone: "error",
          title: "The folder could not be revealed.",
        });
      }
    },
    [beginFeedbackOperation, dismissFeedback, publishFeedbackOperation, storage],
  );

  return {
    confirmClearProgress,
    createFolder,
    deleteBook,
    deleteFolder,
    importEpubs,
    isClearingProgress,
    isDeleting,
    isImporting,
    isRescanning: isRescanning || archiveScanActive,
    moveBook,
    moveFolder,
    prepareBookCover,
    renameBookFile,
    renameFolder,
    requestDeleteBook,
    requestDeleteFolder,
    rescanLibrary,
    revealBookFile,
    revealFolder,
    toggleFavorite,
    writeBookCover,
    writeBookMetadata,
  };
}
