import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";

import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { currentFocusOrigin } from "../../utils/focusRestoration";

export type DroppedEpubImport = {
  destinationFolderPath?: string;
  sourcePaths: string[];
};

export type BookDetailsInitialFocus = "clear-progress" | "close" | "cover" | "metadata";

type BookDialogOwnership = Readonly<{ returnFocusTo: HTMLElement | null }>;

export type LibraryWorkspaceDialog =
  | { type: "none" }
  | { type: "add-epub"; droppedImport: DroppedEpubImport | null }
  | (BookDialogOwnership & {
      type: "book-details";
      bookId: string;
      initialFocus: BookDetailsInitialFocus;
    })
  | (BookDialogOwnership & { type: "book-metadata"; bookId: string })
  | (BookDialogOwnership & { type: "book-cover"; bookId: string })
  | (BookDialogOwnership & { type: "rename-book"; book: Book })
  | (BookDialogOwnership & { type: "move-book"; book: Book })
  | (BookDialogOwnership & { type: "delete-book"; book: Book })
  | (BookDialogOwnership & { type: "clear-progress"; book: Book })
  | { type: "about" }
  | { type: "create-folder" }
  | { type: "rename-folder"; folder: Folder }
  | { type: "move-folder"; folder: Folder }
  | { type: "delete-folder"; folder: Folder }
  | { type: "rescan" }
  | { type: "bulk-move" }
  | { type: "bulk-delete" }
  | { type: "bulk-metadata" };

type DialogAction =
  | { type: "show"; dialog: Exclude<LibraryWorkspaceDialog, { type: "none" }> }
  | { type: "close" }
  | { type: "close-book-editor" };

function dialogReducer(
  state: LibraryWorkspaceDialog,
  action: DialogAction,
): LibraryWorkspaceDialog {
  if (action.type === "show") return action.dialog;
  if (action.type === "close-book-editor") {
    if (state.type === "book-metadata") {
      return {
        type: "book-details",
        bookId: state.bookId,
        initialFocus: "metadata",
        returnFocusTo: state.returnFocusTo,
      };
    }
    if (state.type === "book-cover") {
      return {
        type: "book-details",
        bookId: state.bookId,
        initialFocus: "cover",
        returnFocusTo: state.returnFocusTo,
      };
    }
    return { type: "none" };
  }
  return { type: "none" };
}

function existingBookOrigin(dialog: LibraryWorkspaceDialog): HTMLElement | null | undefined {
  return "returnFocusTo" in dialog ? dialog.returnFocusTo : undefined;
}

export function useLibraryWorkspaceDialogs() {
  const [dialog, dispatch] = useReducer(dialogReducer, { type: "none" });
  const dialogRef = useRef(dialog);
  useLayoutEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  const close = useCallback(() => dispatch({ type: "close" }), []);
  const closeBookEditor = useCallback(() => dispatch({ type: "close-book-editor" }), []);
  const show = useCallback(
    (nextDialog: Exclude<LibraryWorkspaceDialog, { type: "none" }>) =>
      dispatch({ type: "show", dialog: nextDialog }),
    [],
  );
  const bookOrigin = useCallback(
    () => existingBookOrigin(dialogRef.current) ?? currentFocusOrigin(),
    [],
  );

  const openAddEpub = useCallback(
    (droppedImport: DroppedEpubImport | null = null) => show({ type: "add-epub", droppedImport }),
    [show],
  );
  const openBookDetails = useCallback(
    (book: Book) =>
      show({
        type: "book-details",
        bookId: book.id,
        initialFocus: "close",
        returnFocusTo: currentFocusOrigin(),
      }),
    [show],
  );
  const openBookDetailsById = useCallback(
    (bookId: string, initialFocus: BookDetailsInitialFocus = "close") =>
      show({
        type: "book-details",
        bookId,
        initialFocus,
        returnFocusTo: bookOrigin(),
      }),
    [bookOrigin, show],
  );
  const openBookMetadata = useCallback(
    (book: Book) =>
      show({
        type: "book-metadata",
        bookId: book.id,
        returnFocusTo: bookOrigin(),
      }),
    [bookOrigin, show],
  );
  const openBookCover = useCallback(
    (book: Book) => show({ type: "book-cover", bookId: book.id, returnFocusTo: bookOrigin() }),
    [bookOrigin, show],
  );
  const openRenameBook = useCallback(
    (book: Book) => show({ type: "rename-book", book, returnFocusTo: bookOrigin() }),
    [bookOrigin, show],
  );
  const openMoveBook = useCallback(
    (book: Book) => show({ type: "move-book", book, returnFocusTo: bookOrigin() }),
    [bookOrigin, show],
  );
  const openDeleteBook = useCallback(
    (book: Book) => show({ type: "delete-book", book, returnFocusTo: bookOrigin() }),
    [bookOrigin, show],
  );
  const openClearProgress = useCallback(
    (book: Book) => show({ type: "clear-progress", book, returnFocusTo: bookOrigin() }),
    [bookOrigin, show],
  );
  const openAbout = useCallback(() => show({ type: "about" }), [show]);
  const openCreateFolder = useCallback(() => show({ type: "create-folder" }), [show]);
  const openRenameFolder = useCallback(
    (folder: Folder) => show({ type: "rename-folder", folder }),
    [show],
  );
  const openMoveFolder = useCallback(
    (folder: Folder) => show({ type: "move-folder", folder }),
    [show],
  );
  const openDeleteFolder = useCallback(
    (folder: Folder) => show({ type: "delete-folder", folder }),
    [show],
  );
  const openRescan = useCallback(() => show({ type: "rescan" }), [show]);
  const openBulkMove = useCallback(() => show({ type: "bulk-move" }), [show]);
  const openBulkDelete = useCallback(() => show({ type: "bulk-delete" }), [show]);
  const openBulkMetadata = useCallback(() => show({ type: "bulk-metadata" }), [show]);

  const actions = useMemo(
    () => ({
      close,
      closeBookEditor,
      openAbout,
      openAddEpub,
      openBookCover,
      openBookDetails,
      openBookDetailsById,
      openBookMetadata,
      openBulkDelete,
      openBulkMetadata,
      openBulkMove,
      openClearProgress,
      openCreateFolder,
      openDeleteBook,
      openDeleteFolder,
      openMoveBook,
      openMoveFolder,
      openRenameBook,
      openRenameFolder,
      openRescan,
    }),
    [
      close,
      closeBookEditor,
      openAbout,
      openAddEpub,
      openBookCover,
      openBookDetails,
      openBookDetailsById,
      openBookMetadata,
      openBulkDelete,
      openBulkMetadata,
      openBulkMove,
      openClearProgress,
      openCreateFolder,
      openDeleteBook,
      openDeleteFolder,
      openMoveBook,
      openMoveFolder,
      openRenameBook,
      openRenameFolder,
      openRescan,
    ],
  );

  return { actions, dialog };
}

export type LibraryWorkspaceDialogActions = ReturnType<
  typeof useLibraryWorkspaceDialogs
>["actions"];
