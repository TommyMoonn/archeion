import { useState } from "react";

import { LibraryWorkspaceDialogs } from "../../../src/features/library/LibraryWorkspaceDialogs";
import { useLibraryWorkspaceDialogs } from "../../../src/features/library/useLibraryWorkspaceDialogs";
import { ReaderNoteEditor } from "../../../src/features/reader/ReaderNoteEditor";
import type {
  LibrarySnapshotBook,
  LibrarySnapshotFolder,
} from "../../../src/storage/LibraryStorage";

const book: LibrarySnapshotBook = {
  id: "confirmation-book",
  fileName: "Fixture.epub",
  relativePath: "Fixture.epub",
  originalTitle: "Fixture",
  isFavorite: false,
  addedAt: "1",
  updatedAt: "1",
  progressPercent: 32,
  progressCfi: "epubcfi(/6/4)",
};

const folder: LibrarySnapshotFolder = {
  id: "confirmation-folder",
  name: "Fixture folder",
  relativePath: "Fixture folder",
  createdAt: "1",
  updatedAt: "1",
};

function ignore() {}

async function unsupportedOperation(): Promise<never> {
  throw new Error("This operation is outside the confirmation fixture.");
}

export function ReaderNoteConfirmationFixture() {
  const [deletes, setDeletes] = useState(0);

  return (
    <main className="reader-page" style={{ height: 500 }}>
      <output data-testid="mutation-count">{deletes}</output>
      <ReaderNoteEditor
        state={{
          deleting: false,
          errorKind: null,
          hasPersistedNote: true,
          status: "idle",
          text: "Fixture note",
        }}
        onBack={ignore}
        onDelete={() => setDeletes((count) => count + 1)}
        onDraftChange={ignore}
        onRetry={ignore}
        onUnmount={ignore}
      />
    </main>
  );
}

export function LibraryConfirmationFixture() {
  const { dialog, actions } = useLibraryWorkspaceDialogs();
  const [mutations, setMutations] = useState(0);
  const recordMutation = async () => {
    setMutations((count) => count + 1);
  };

  return (
    <main style={{ padding: 24 }}>
      <output data-testid="mutation-count">{mutations}</output>
      <button type="button" onClick={() => actions.openClearProgress(book)}>
        Clear reading progress
      </button>
      <button type="button" onClick={() => actions.openDeleteBook(book)}>
        Delete book
      </button>
      <button type="button" onClick={actions.openBulkDelete}>
        Delete selected books
      </button>
      <button type="button" onClick={() => actions.openDeleteFolder(folder)}>
        Delete folder
      </button>
      <LibraryWorkspaceDialogs
        books={[book]}
        confirmDestructiveFileActions
        dialog={dialog}
        dialogActions={actions}
        folders={[folder]}
        importDefaults={{ defaultConflictAction: "skip", defaultMode: "copy" }}
        isBulkRunning={false}
        isClearingProgress={false}
        isDeleting={false}
        isImporting={false}
        isRescanning={false}
        onConfirmClearProgress={recordMutation}
        onCreateFolder={unsupportedOperation}
        onDeleteBook={recordMutation}
        onDeleteFolder={recordMutation}
        onDeleteSelectedBooks={recordMutation}
        onImport={unsupportedOperation}
        onMoveBook={unsupportedOperation}
        onMoveFolder={unsupportedOperation}
        onMoveSelectedBooks={unsupportedOperation}
        onPrepareBookCover={unsupportedOperation}
        onReadBook={ignore}
        onReadBookFromBeginning={ignore}
        onRenameBookFile={unsupportedOperation}
        onRenameFolder={unsupportedOperation}
        onRequestClearProgress={actions.openClearProgress}
        onRequestDeleteBook={actions.openDeleteBook}
        onRescan={unsupportedOperation}
        onRevealBookFile={unsupportedOperation}
        onToggleFavorite={unsupportedOperation}
        onWriteBookCover={unsupportedOperation}
        onWriteBookMetadata={unsupportedOperation}
        onWriteSelectedBookMetadata={unsupportedOperation}
        selectedBookIds={new Set([book.id])}
        selectedBooks={[book]}
      />
    </main>
  );
}
