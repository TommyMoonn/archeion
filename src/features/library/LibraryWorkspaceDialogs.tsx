import { AsyncDialogShell } from "../../components/AsyncDialogShell";
import {
  Plus,
  FolderPlus,
  Save,
  Pencil,
  MoveRight,
  ListChecks,
  Trash2,
  Eraser,
  RefreshCw,
} from "lucide-react";
import { LibraryDialogSkeleton } from "./LibraryDialogSkeleton";
import { BULK_METADATA_DESCRIPTION } from "./bulkMetadataDialogModel";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
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
import type { GlobalImportSettings } from "../../types/settings";
import { bookTitle } from "./libraryFilters";
import { isInsideFolder } from "./libraryFolderRelations";
import {
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
  dialog: LibraryWorkspaceDialog;
  dialogActions: LibraryWorkspaceDialogActions;
  folders: readonly LibrarySnapshotFolder[] | undefined;
  importDefaults: GlobalImportSettings;
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
  const loadingContent = (
    <LibraryDialogSkeleton
      dialog={dialog}
      books={books ?? []}
      folders={folders ?? []}
      importDefaults={importDefaults}
      selectedBooks={selectedBooks}
    />
  );

  if (dialog.type === "add-epub") {
    return (
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={dialog.type}
        title="Add EPUB files"
        actionLabel="Add EPUB"
        actionIcon={<Plus aria-hidden="true" />}
        onClose={dialogActions.close}
        closeOnBackdropClick={!dialog.droppedImport?.sourcePaths.length}
      >
        <AddEpubDialog
          confirmDestructiveFileActions={confirmDestructiveFileActions}
          folders={folders ?? []}
          importDefaults={importDefaults}
          initialFolderPath={dialog.droppedImport?.destinationFolderPath}
          initialSourcePaths={dialog.droppedImport?.sourcePaths}
          isImporting={isImporting}
          onClose={dialogActions.close}
          onImport={onImport}
        />
      </AsyncDialogShell>
    );
  }

  if (dialog.type === "book-details") {
    const book = findBook(books, dialog.bookId);
    if (!book) return null;
    return (
      <BookDetailsDrawer
        key={book.id}
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
    );
  }

  if (dialog.type === "book-metadata") {
    const book = findBook(books, dialog.bookId);
    if (!book) return null;
    return (
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={`${dialog.type}:${book.id}`}
        title="Edit EPUB metadata"
        actionLabel="Write metadata to EPUB"
        actionIcon={<Save aria-hidden="true" />}
        className="dialog--metadata-writeback"
        workspace
        feedbackSize="summary"
        closeOnBackdropClick={false}
        dismissLabel="Close"
        onClose={dialogActions.closeBookEditor}
        returnFocusTo={dialog.returnFocusTo}
      >
        <BookAdvancedMetadataDialog
          book={book}
          onClose={dialogActions.closeBookEditor}
          onWriteMetadata={onWriteBookMetadata}
          returnFocusTo={dialog.returnFocusTo}
        />
      </AsyncDialogShell>
    );
  }

  if (dialog.type === "book-cover") {
    const book = findBook(books, dialog.bookId);
    if (!book) return null;
    return (
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={`${dialog.type}:${book.id}`}
        title="Replace embedded cover"
        actionLabel="Write cover to EPUB"
        actionIcon={<Save aria-hidden="true" />}
        dismissLabel="Close"
        className="dialog--cover-writeback"
        workspace
        feedbackPlacement="inline"
        onClose={dialogActions.closeBookEditor}
        returnFocusTo={dialog.returnFocusTo}
      >
        <BookCoverWritebackDialog
          book={book}
          onClose={dialogActions.closeBookEditor}
          onPrepareCover={onPrepareBookCover}
          onWriteCover={onWriteBookCover}
          returnFocusTo={dialog.returnFocusTo}
        />
      </AsyncDialogShell>
    );
  }

  if (dialog.type === "rename-book") {
    return (
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={`${dialog.type}:${dialog.book.id}`}
        title="Rename EPUB file"
        actionLabel="Rename file"
        actionIcon={<Pencil aria-hidden="true" />}
        onClose={dialogActions.close}
        returnFocusTo={dialog.returnFocusTo}
      >
        <RenameFileDialog
          book={dialog.book}
          onClose={dialogActions.close}
          onRename={(fileName) => onRenameBookFile(dialog.book, fileName)}
          returnFocusTo={dialog.returnFocusTo}
        />
      </AsyncDialogShell>
    );
  }

  if (dialog.type === "move-book") {
    return (
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={`${dialog.type}:${dialog.book.id}`}
        title="Move EPUB file"
        actionLabel="Move"
        actionIcon={<MoveRight aria-hidden="true" />}
        onClose={dialogActions.close}
        returnFocusTo={dialog.returnFocusTo}
      >
        <MoveToFolderDialog
          currentFolderId={dialog.book.folderId ?? null}
          folders={folders ?? []}
          onClose={dialogActions.close}
          onMove={(folderId) => onMoveBook(dialog.book, folderId)}
          returnFocusTo={dialog.returnFocusTo}
          title="Move EPUB file"
        />
      </AsyncDialogShell>
    );
  }

  if (dialog.type === "create-folder") {
    return (
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={dialog.type}
        title="Create folder"
        actionLabel="Create"
        actionIcon={<FolderPlus aria-hidden="true" />}
        onClose={dialogActions.close}
      >
        <FolderCreateDialog onClose={dialogActions.close} onCreate={onCreateFolder} />
      </AsyncDialogShell>
    );
  }

  if (dialog.type === "rename-folder") {
    return (
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={`${dialog.type}:${dialog.folder.id}`}
        title="Rename folder"
        actionLabel="Save"
        actionIcon={<Save aria-hidden="true" />}
        onClose={dialogActions.close}
      >
        <FolderRenameDialog
          folder={dialog.folder}
          onClose={dialogActions.close}
          onRename={(name) => onRenameFolder(dialog.folder, name)}
        />
      </AsyncDialogShell>
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
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={`${dialog.type}:${dialog.folder.id}`}
        title="Move folder"
        actionLabel="Move"
        actionIcon={<MoveRight aria-hidden="true" />}
        onClose={dialogActions.close}
      >
        <MoveToFolderDialog
          currentFolderId={dialog.folder.parentId ?? null}
          excludedFolderIds={excludedFolderIds}
          folders={folders ?? []}
          onClose={dialogActions.close}
          onMove={(folderId) => onMoveFolder(dialog.folder, folderId)}
          title="Move folder"
        />
      </AsyncDialogShell>
    );
  }

  if (dialog.type === "delete-book") {
    return (
      <Dialog
        returnFocusTo={dialog.returnFocusTo}
        title={dialog.book.isFileMissing ? "Remove book metadata?" : "Delete EPUB file?"}
        feedback={
          <p role="status">
            {isDeleting
              ? dialog.book.isFileMissing
                ? "Removing metadata…"
                : "Deleting EPUB…"
              : ""}
          </p>
        }
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
              icon={<Trash2 aria-hidden="true" />}
              busy={isDeleting}
              disabled={isDeleting}
              onClick={() => void onDeleteBook(dialog.book)}
            >
              {dialog.book.isFileMissing ? "Remove metadata" : "Delete EPUB"}
            </Button>
          </>
        }
      />
    );
  }

  if (dialog.type === "bulk-move") {
    return (
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={dialog.type}
        title={`Move ${selectedBookIds.size} selected books`}
        actionLabel="Move"
        actionIcon={<MoveRight aria-hidden="true" />}
        onClose={dialogActions.close}
      >
        <MoveToFolderDialog
          disableUnchanged={false}
          folders={folders ?? []}
          onClose={dialogActions.close}
          onMove={onMoveSelectedBooks}
          title={`Move ${selectedBookIds.size} selected books`}
        />
      </AsyncDialogShell>
    );
  }

  if (dialog.type === "bulk-metadata") {
    return (
      <AsyncDialogShell
        loadingContent={loadingContent}
        key={dialog.type}
        title={`Edit metadata for ${selectedBooks.length} books`}
        actionLabel="Review changes"
        actionIcon={<ListChecks aria-hidden="true" />}
        loadingDescription={BULK_METADATA_DESCRIPTION}
        reserveFeedback={false}
        reserveActionIndicator={false}
        className="dialog--bulk-metadata"
        onClose={dialogActions.close}
        closeOnBackdropClick={false}
      >
        <BulkMetadataDialog
          books={selectedBooks}
          isWriting={isBulkRunning}
          onApply={onWriteSelectedBookMetadata}
          onClose={dialogActions.close}
        />
      </AsyncDialogShell>
    );
  }

  if (dialog.type === "bulk-delete") {
    return (
      <Dialog
        title={`Delete ${selectedBookIds.size} selected books?`}
        feedback={<p role="status">{isBulkRunning ? "Deleting selected books…" : ""}</p>}
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
              icon={<Trash2 aria-hidden="true" />}
              busy={isBulkRunning}
              disabled={isBulkRunning}
              onClick={() => void onDeleteSelectedBooks()}
              variant="danger"
            >
              Delete selected books
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
        feedback={<p role="status">{isClearingProgress ? "Clearing reading progress…" : ""}</p>}
        description={`This resets the saved reading position for “${bookTitle(dialog.book)}”. The EPUB file and last-opened date are not changed.`}
        onClose={() => {
          if (!isClearingProgress)
            dialogActions.openBookDetailsById(dialog.book.id, "clear-progress");
        }}
        footer={
          <>
            <Button
              autoFocus
              disabled={isClearingProgress}
              onClick={() => dialogActions.openBookDetailsById(dialog.book.id, "clear-progress")}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              icon={<Eraser aria-hidden="true" />}
              busy={isClearingProgress}
              disabled={isClearingProgress}
              onClick={() => void onConfirmClearProgress(dialog.book)}
            >
              Clear progress
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
              icon={<RefreshCw aria-hidden="true" />}
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
      title={`Delete “${dialog.folder.name}” folder?`}
      feedback={<p role="status">{isDeleting ? "Deleting folder…" : ""}</p>}
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
            icon={<Trash2 aria-hidden="true" />}
            busy={isDeleting}
            disabled={isDeleting}
            onClick={() => void onDeleteFolder(dialog.folder)}
          >
            Delete folder
          </Button>
        </>
      }
    />
  );
}
