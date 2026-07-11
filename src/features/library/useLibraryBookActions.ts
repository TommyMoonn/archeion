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
  shouldConfirmBookDeletion,
  shouldConfirmFolderDeletion,
} from "../filesystem/destructiveActionPolicy";
import {
  createDeleteErrorFeedbackToken,
  createDeleteSuccessFeedbackToken,
  createFolderSuccessFeedbackToken,
  createImportFeedbackToken,
  type LibraryFeedbackDraft,
} from "./libraryFeedback";
import { isInsideFolder } from "./libraryFolderRelations";
import type { LibraryWorkspaceDialogActions } from "./useLibraryWorkspaceDialogs";

type UseLibraryBookActionsInput = {
  changeLocation: (location: LibraryLocation) => void;
  confirmDestructiveFileActions: boolean;
  currentFolder: Folder | undefined;
  dialogs: LibraryWorkspaceDialogActions;
  dismissFeedback: (id: string) => void;
  location: LibraryLocation;
  pushFeedback: (feedback: LibraryFeedbackDraft) => string;
  showLibraryError: (title: string, detail?: string) => void;
  showRescanError: () => void;
  showRescanSuccess: () => void;
  storage: LibraryStorage;
};

export function useLibraryBookActions({
  changeLocation,
  confirmDestructiveFileActions,
  currentFolder,
  dialogs,
  dismissFeedback,
  location,
  pushFeedback,
  showLibraryError,
  showRescanError,
  showRescanSuccess,
  storage,
}: UseLibraryBookActionsInput) {
  const importLock = useRef(false);
  const deleteLock = useRef(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClearingProgress, setIsClearingProgress] = useState(false);

  const importEpubs = useCallback(
    async (input: AddArchiveEpubInput) => {
      if (importLock.current) return;

      importLock.current = true;
      setIsImporting(true);
      dismissFeedback("library-error");
      dismissFeedback("archive-import");

      try {
        const results = await storage.addEpubFilesToArchive(input);
        const feedback = createImportFeedbackToken("archive-import", results);
        if (feedback) pushFeedback(feedback);
      } catch (error) {
        pushFeedback({
          id: "archive-import",
          tone: "error",
          title: "The EPUB files could not be added.",
        });
        throw error;
      } finally {
        importLock.current = false;
        setIsImporting(false);
      }
    },
    [dismissFeedback, pushFeedback, storage],
  );

  const deleteBook = useCallback(
    async (book: Book) => {
      if (deleteLock.current) return;

      deleteLock.current = true;
      setIsDeleting(true);
      dismissFeedback("library-error");

      try {
        await storage.deleteBook(book.id);
        pushFeedback(
          createDeleteSuccessFeedbackToken(book.isFileMissing ? "metadataRemoved" : "bookDeleted"),
        );
      } catch {
        pushFeedback(
          createDeleteErrorFeedbackToken(
            book.isFileMissing ? "metadataRemoveFailed" : "bookDeleteFailed",
          ),
        );
      } finally {
        dialogs.close();
        deleteLock.current = false;
        setIsDeleting(false);
      }
    },
    [dialogs, dismissFeedback, pushFeedback, storage],
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
      dismissFeedback("library-error");

      try {
        await storage.deleteFolder(folder.id);
        if (
          location.type === "folder" &&
          (location.folderId === folder.id || isInsideFolder(currentFolder?.relativePath, folder))
        ) {
          changeLocation({ type: "library" });
        }
        pushFeedback(createDeleteSuccessFeedbackToken("folderDeleted"));
      } catch {
        pushFeedback(createDeleteErrorFeedbackToken("folderDeleteFailed"));
      } finally {
        dialogs.close();
        deleteLock.current = false;
        setIsDeleting(false);
      }
    },
    [changeLocation, currentFolder, dialogs, dismissFeedback, location, pushFeedback, storage],
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
      dismissFeedback("clear-progress");
      try {
        const updated = await storage.updateBook(book.id, {
          progressCfi: undefined,
          progressPercent: 0,
        });
        if (!updated) {
          throw new Error("The active archive changed before progress was cleared.");
        }
        pushFeedback({
          id: "clear-progress",
          tone: "success",
          title: "Reading progress cleared.",
          autoDismiss: true,
        });
      } catch {
        pushFeedback({
          id: "clear-progress",
          tone: "error",
          title: "Reading progress could not be cleared.",
        });
      } finally {
        dialogs.openBookDetailsById(book.id);
        setIsClearingProgress(false);
      }
    },
    [dialogs, dismissFeedback, isClearingProgress, pushFeedback, storage],
  );

  const rescanLibrary = useCallback(async () => {
    dismissFeedback("library-error");
    try {
      await storage.rescan();
      showRescanSuccess();
    } catch {
      showRescanError();
    }
  }, [dismissFeedback, showRescanError, showRescanSuccess, storage]);

  const revealBookFile = useCallback(
    async (book: Book) => {
      if (!book.relativePath) return;
      dismissFeedback("library-error");
      try {
        await storage.revealBookFile(book.id);
      } catch {
        showLibraryError("The EPUB could not be revealed in its folder.");
      }
    },
    [dismissFeedback, showLibraryError, storage],
  );

  const toggleFavorite = useCallback(
    async (book: Book) => {
      dismissFeedback("library-error");
      try {
        await storage.updateBook(book.id, { isFavorite: !book.isFavorite });
      } catch {
        showLibraryError("Favorite status could not be updated.");
      }
    },
    [dismissFeedback, showLibraryError, storage],
  );

  const writeBookMetadata = useCallback(
    (book: Book, metadata: EpubMetadataWritebackInput) =>
      storage.writeBookMetadata(book.id, metadata),
    [storage],
  );
  const prepareBookCover = useCallback(
    (book: Book, imagePath: string, framing: EpubCoverFraming): Promise<EpubCoverPreparation> =>
      storage.prepareBookCover(book.id, imagePath, framing),
    [storage],
  );
  const writeBookCover = useCallback(
    (book: Book, input: EpubCoverWritebackInput): Promise<EpubCoverWritebackResult> =>
      storage.writeBookCover(book.id, input),
    [storage],
  );

  const renameBookFile = useCallback(
    async (book: Book, fileName: string) => {
      dismissFeedback("library-error");
      await storage.renameBookFile(book.id, fileName);
    },
    [dismissFeedback, storage],
  );
  const moveBook = useCallback(
    async (book: Book, folderId: string | null) => {
      dismissFeedback("library-error");
      await storage.moveBookToFolder(book.id, folderId);
    },
    [dismissFeedback, storage],
  );
  const createFolder = useCallback(
    async (name: string) => {
      await storage.createFolder({
        name,
        parentId: location.type === "folder" ? location.folderId : null,
      });
      pushFeedback(createFolderSuccessFeedbackToken());
    },
    [location, pushFeedback, storage],
  );
  const renameFolder = useCallback(
    async (folder: Folder, name: string) => {
      await storage.updateFolder(folder.id, { name });
    },
    [storage],
  );
  const moveFolder = useCallback(
    async (folder: Folder, folderId: string | null) => {
      await storage.updateFolder(folder.id, { parentId: folderId });
    },
    [storage],
  );
  const revealFolder = useCallback(
    async (folder: Folder) => {
      dismissFeedback("library-error");
      try {
        await storage.revealFolder(folder.id);
      } catch {
        showLibraryError("The folder could not be revealed.");
      }
    },
    [dismissFeedback, showLibraryError, storage],
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
