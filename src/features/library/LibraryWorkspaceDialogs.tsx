import { Suspense } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { DialogLoadingFallback } from "../../components/DialogLoadingFallback";
import type {
  AddArchiveEpubInput,
  LibrarySnapshotBook,
  LibrarySnapshotFolder,
} from "../../storage/LibraryStorage";
import type {
  BulkMetadataEditInput,
  EpubCoverFraming,
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
  EpubMetadataWritebackInput,
  EpubMetadataWritebackResult,
} from "../../types/book";
import type { ImportSettings } from "../../types/settings";
import { bookTitle } from "./libraryFilters";
import { isInsideFolder } from "./libraryFolderRelations";
import {
  AboutDialog,
  AddEpubDialog,
  BookAdvancedMetadataDialog,
  BookCoverWritebackDialog,
  BookDetailsDrawer,
  BulkMetadataDialog,
  FolderCreateDialog,
  FolderRenameDialog,
  MoveToFolderDialog,
  RenameFileDialog,
} from "./libraryLazySurfaces";
import type {
  LibraryWorkspaceDialog,
  LibraryWorkspaceDialogActions,
} from "./useLibraryWorkspaceDialogs";

type LibraryWorkspaceDialogsProps = {
  books: readonly LibrarySnapshotBook[] | undefined;
  confirmDestructiveFileActions: boolean;
  currentFolder: LibrarySnapshotFolder | undefined;
  dialog: LibraryWorkspaceDialog;
  dialogActions: LibraryWorkspaceDialogActions;
  folders: readonly LibrarySnapshotFolder[] | undefined;
  importDefaults: ImportSettings;
  isBulkRunning: boolean;
  isClearingProgress: boolean;
  isDeleting: boolean;
  isImporting: boolean;
  isRescanning: boolean;
  onConfirmClearProgress: (book: LibrarySnapshotBook) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onDeleteBook: (book: LibrarySnapshotBook) => Promise<void>;
  onDeleteFolder: (folder: LibrarySnapshotFolder) => Promise<void>;
  onDeleteSelectedBooks: () => Promise<void>;
  onImport: (input: AddArchiveEpubInput) => Promise<void>;
  onMoveBook: (book: LibrarySnapshotBook, folderId: string | null) => Promise<void>;
  onMoveFolder: (folder: LibrarySnapshotFolder, folderId: string | null) => Promise<void>;
  onMoveSelectedBooks: (folderId: string | null) => Promise<void>;
  onPrepareBookCover: (
    book: LibrarySnapshotBook,
    imagePath: string,
    framing: EpubCoverFraming,
  ) => Promise<EpubCoverPreparation>;
  onReadBook: (book: LibrarySnapshotBook) => void;
  onReadBookFromBeginning: (book: LibrarySnapshotBook) => void;
  onRenameBookFile: (book: LibrarySnapshotBook, fileName: string) => Promise<void>;
  onRenameFolder: (folder: LibrarySnapshotFolder, name: string) => Promise<void>;
  onRequestClearProgress: (book: LibrarySnapshotBook) => void;
  onRequestDeleteBook: (book: LibrarySnapshotBook) => void;
  onRescan: () => Promise<void>;
  onRevealBookFile: (book: LibrarySnapshotBook) => Promise<void>;
  onToggleFavorite: (book: LibrarySnapshotBook) => Promise<void>;
  onWriteBookCover: (
    book: LibrarySnapshotBook,
    input: EpubCoverWritebackInput,
  ) => Promise<EpubCoverWritebackResult>;
  onWriteBookMetadata: (
    book: LibrarySnapshotBook,
    metadata: EpubMetadataWritebackInput,
  ) => Promise<EpubMetadataWritebackResult>;
  onWriteSelectedBookMetadata: (edits: BulkMetadataEditInput) => Promise<void>;
  selectedBookIds: ReadonlySet<string>;
  selectedBooks: LibrarySnapshotBook[];
};

function findBook(
  books: readonly LibrarySnapshotBook[] | undefined,
  bookId: string,
): LibrarySnapshotBook | null {
  return (books ?? []).find((book) => book.id === bookId) ?? null;
}

export function LibraryWorkspaceDialogs({
  books,
  confirmDestructiveFileActions,
  currentFolder,
  dialog,
  dialogActions,
  folders,
  importDefaults,
  isBulkRunning,
  isClearingProgress,
  isDeleting,
  isImporting,
  isRescanning,
  onConfirmClearProgress,
  onCreateFolder,
  onDeleteBook,
  onDeleteFolder,
  onDeleteSelectedBooks,
  onImport,
  onMoveBook,
  onMoveFolder,
  onMoveSelectedBooks,
  onPrepareBookCover,
  onReadBook,
  onReadBookFromBeginning,
  onRenameBookFile,
  onRenameFolder,
  onRequestClearProgress,
  onRequestDeleteBook,
  onRescan,
  onRevealBookFile,
  onToggleFavorite,
  onWriteBookCover,
  onWriteBookMetadata,
  onWriteSelectedBookMetadata,
  selectedBookIds,
  selectedBooks,
}: LibraryWorkspaceDialogsProps) {
  if (dialog.type === "none") return null;

  if (dialog.type === "add-epub") {
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening import dialog" />}>
        <AddEpubDialog
          confirmDestructiveFileActions={confirmDestructiveFileActions}
          folders={folders ?? []}
          importDefaults={importDefaults}
          initialFolderPath={
            dialog.droppedImport
              ? dialog.droppedImport.destinationFolderPath
              : currentFolder?.relativePath
          }
          initialSourcePaths={dialog.droppedImport?.sourcePaths}
          isImporting={isImporting}
          onClose={dialogActions.close}
          onImport={onImport}
        />
      </Suspense>
    );
  }

  if (dialog.type === "book-details") {
    const book = findBook(books, dialog.bookId);
    if (!book) return null;
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening book details" />}>
        <BookDetailsDrawer
          book={book}
          initialFocus={dialog.initialFocus}
          canManageFile
          canRevealFile
          onClearProgress={onRequestClearProgress}
          onClose={dialogActions.close}
          onDelete={onRequestDeleteBook}
          onMoveFile={dialogActions.openMoveBook}
          onRead={onReadBook}
          onReadFromBeginning={onReadBookFromBeginning}
          onRenameFile={dialogActions.openRenameBook}
          onReplaceCover={dialogActions.openBookCover}
          onRescan={dialogActions.openRescan}
          onRevealFile={(target) => void onRevealBookFile(target)}
          onToggleFavorite={(target) => void onToggleFavorite(target)}
          onViewMetadata={dialogActions.openBookMetadata}
          returnFocusTo={dialog.returnFocusTo}
        />
      </Suspense>
    );
  }

  if (dialog.type === "book-metadata") {
    const book = findBook(books, dialog.bookId);
    if (!book) return null;
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening metadata editor" />}>
        <BookAdvancedMetadataDialog
          book={book}
          onClose={dialogActions.closeBookEditor}
          onWriteMetadata={onWriteBookMetadata}
          returnFocusTo={dialog.returnFocusTo}
        />
      </Suspense>
    );
  }

  if (dialog.type === "book-cover") {
    const book = findBook(books, dialog.bookId);
    if (!book) return null;
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening cover editor" />}>
        <BookCoverWritebackDialog
          book={book}
          onClose={dialogActions.closeBookEditor}
          onPrepareCover={onPrepareBookCover}
          onWriteCover={onWriteBookCover}
          returnFocusTo={dialog.returnFocusTo}
        />
      </Suspense>
    );
  }

  if (dialog.type === "rename-book") {
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening rename dialog" />}>
        <RenameFileDialog
          book={dialog.book}
          onClose={dialogActions.close}
          onRename={(fileName) => onRenameBookFile(dialog.book, fileName)}
          returnFocusTo={dialog.returnFocusTo}
        />
      </Suspense>
    );
  }

  if (dialog.type === "move-book") {
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening move dialog" />}>
        <MoveToFolderDialog
          currentFolderId={dialog.book.folderId ?? null}
          folders={folders ?? []}
          onClose={dialogActions.close}
          onMove={(folderId) => onMoveBook(dialog.book, folderId)}
          returnFocusTo={dialog.returnFocusTo}
          title="Move EPUB file"
        />
      </Suspense>
    );
  }

  if (dialog.type === "about") {
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening About" />}>
        <AboutDialog onClose={dialogActions.close} />
      </Suspense>
    );
  }

  if (dialog.type === "create-folder") {
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening folder dialog" />}>
        <FolderCreateDialog onClose={dialogActions.close} onCreate={onCreateFolder} />
      </Suspense>
    );
  }

  if (dialog.type === "rename-folder") {
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening folder dialog" />}>
        <FolderRenameDialog
          folder={dialog.folder}
          onClose={dialogActions.close}
          onRename={(name) => onRenameFolder(dialog.folder, name)}
        />
      </Suspense>
    );
  }

  if (dialog.type === "move-folder") {
    const excludedFolderIds = (folders ?? [])
      .filter(
        (folder) =>
          folder.id === dialog.folder.id || isInsideFolder(folder.relativePath, dialog.folder),
      )
      .map((folder) => folder.id);
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening move dialog" />}>
        <MoveToFolderDialog
          currentFolderId={dialog.folder.parentId ?? null}
          excludedFolderIds={excludedFolderIds}
          folders={folders ?? []}
          onClose={dialogActions.close}
          onMove={(folderId) => onMoveFolder(dialog.folder, folderId)}
          title="Move folder"
        />
      </Suspense>
    );
  }

  if (dialog.type === "delete-book") {
    return (
      <Dialog
        returnFocusTo={dialog.returnFocusTo}
        title={dialog.book.isFileMissing ? "Remove book metadata?" : "Delete EPUB file?"}
        description={
          dialog.book.isFileMissing
            ? `Favorites and progress for “${bookTitle(dialog.book)}” will be removed. No EPUB file will be deleted.`
            : `The EPUB file for “${bookTitle(dialog.book)}” will be moved to Trash when available. Reading data will be removed.`
        }
        onClose={() => {
          if (!isDeleting) dialogActions.close();
        }}
        footer={
          <>
            <Button variant="secondary" disabled={isDeleting} onClick={dialogActions.close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={isDeleting}
              onClick={() => void onDeleteBook(dialog.book)}
            >
              {isDeleting
                ? "Removing"
                : dialog.book.isFileMissing
                  ? "Remove metadata"
                  : "Delete EPUB"}
            </Button>
          </>
        }
      />
    );
  }

  if (dialog.type === "bulk-move") {
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening move dialog" />}>
        <MoveToFolderDialog
          disableUnchanged={false}
          folders={folders ?? []}
          onClose={dialogActions.close}
          onMove={onMoveSelectedBooks}
          title={`Move ${selectedBookIds.size} selected books`}
        />
      </Suspense>
    );
  }

  if (dialog.type === "bulk-metadata") {
    return (
      <Suspense fallback={<DialogLoadingFallback label="Opening metadata editor" />}>
        <BulkMetadataDialog
          books={selectedBooks}
          isWriting={isBulkRunning}
          onApply={onWriteSelectedBookMetadata}
          onClose={dialogActions.close}
        />
      </Suspense>
    );
  }

  if (dialog.type === "bulk-delete") {
    return (
      <Dialog
        title={`Delete ${selectedBookIds.size} selected books?`}
        description="Available EPUB files will be moved to the Recycle Bin or platform Trash. Saved library data for successful items will also be removed."
        onClose={() => {
          if (!isBulkRunning) dialogActions.close();
        }}
        footer={
          <>
            <Button disabled={isBulkRunning} onClick={dialogActions.close} variant="secondary">
              Cancel
            </Button>
            <Button
              disabled={isBulkRunning}
              onClick={() => void onDeleteSelectedBooks()}
              variant="danger"
            >
              {isBulkRunning ? "Deleting" : "Delete selected"}
            </Button>
          </>
        }
      />
    );
  }

  if (dialog.type === "clear-progress") {
    return (
      <Dialog
        returnFocusTo={dialog.returnFocusTo}
        title="Clear reading progress?"
        description={`This resets the saved reading position for “${bookTitle(dialog.book)}”. The EPUB file and last-opened date are not changed.`}
        onClose={() => {
          if (!isClearingProgress)
            dialogActions.openBookDetailsById(dialog.book.id, "clear-progress");
        }}
        footer={
          <>
            <Button
              disabled={isClearingProgress}
              onClick={() => dialogActions.openBookDetailsById(dialog.book.id, "clear-progress")}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              autoFocus
              disabled={isClearingProgress}
              onClick={() => void onConfirmClearProgress(dialog.book)}
            >
              {isClearingProgress ? "Clearing" : "Clear progress"}
            </Button>
          </>
        }
      />
    );
  }

  if (dialog.type === "rescan") {
    return (
      <Dialog
        title="Rescan archive?"
        description="This refreshes book and missing-file records. EPUB files are not changed."
        onClose={() => {
          if (!isRescanning) dialogActions.close();
        }}
        footer={
          <>
            <Button disabled={isRescanning} onClick={dialogActions.close} variant="secondary">
              Cancel
            </Button>
            <Button
              autoFocus
              busy={isRescanning}
              disabled={isRescanning}
              onClick={() => {
                dialogActions.close();
                void onRescan();
              }}
            >
              Rescan archive
            </Button>
          </>
        }
      />
    );
  }

  const deleteFolderBookCount = (books ?? []).filter((book) =>
    isInsideFolder(book.relativePath, dialog.folder),
  ).length;
  return (
    <Dialog
      title="Delete this folder?"
      description={`The “${dialog.folder.name}” folder and ${deleteFolderBookCount} contained EPUB ${
        deleteFolderBookCount === 1 ? "file" : "files"
      } will be moved to Trash when available.`}
      onClose={() => {
        if (!isDeleting) dialogActions.close();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={isDeleting} onClick={dialogActions.close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={isDeleting}
            onClick={() => void onDeleteFolder(dialog.folder)}
          >
            {isDeleting ? "Deleting" : "Delete folder"}
          </Button>
        </>
      }
    />
  );
}
