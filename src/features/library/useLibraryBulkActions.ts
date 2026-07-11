import { useCallback, useMemo, useState } from "react";

import type { BulkActionResult, LibraryStorage } from "../../storage/LibraryStorage";
import type { Book, BulkMetadataEditInput } from "../../types/book";
import { bookTitle } from "./libraryFilters";
import { createBulkActionFeedbackToken, type LibraryFeedbackDraft } from "./libraryFeedback";
import type { LibraryWorkspaceDialogActions } from "./useLibraryWorkspaceDialogs";

type UseLibraryBulkActionsInput = {
  books: Book[] | undefined;
  dialogs: LibraryWorkspaceDialogActions;
  dismissFeedback: (id: string) => void;
  leaveSelectionMode: () => void;
  pushFeedback: (feedback: LibraryFeedbackDraft) => string;
  retainSelection: (bookIds: ReadonlySet<string>) => void;
  selectedBookIds: ReadonlySet<string>;
  storage: LibraryStorage;
};

export type LibraryBulkAction =
  | "favorite"
  | "unfavorite"
  | "move"
  | "delete"
  | "edit-metadata"
  | "metadata"
  | "covers"
  | "export";

export function useLibraryBulkActions({
  books,
  dialogs,
  dismissFeedback,
  leaveSelectionMode,
  pushFeedback,
  retainSelection,
  selectedBookIds,
  storage,
}: UseLibraryBulkActionsInput) {
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const selectedBooks = useMemo(
    () => (books ?? []).filter((book) => selectedBookIds.has(book.id)),
    [books, selectedBookIds],
  );

  const runBulkAction = useCallback(
    async (label: string, action: (ids: readonly string[]) => Promise<BulkActionResult>) => {
      if (isBulkRunning) return;

      const ids = [...selectedBookIds];
      const labels = new Map((books ?? []).map((book) => [book.id, bookTitle(book)]));
      setIsBulkRunning(true);
      dismissFeedback("bulk-action");
      try {
        const result = await action(ids);
        pushFeedback(createBulkActionFeedbackToken(label, result, labels));
        const retryBookIds = new Set([
          ...result.failed.map(({ bookId }) => bookId),
          ...result.skipped.map(({ bookId }) => bookId),
        ]);
        if (retryBookIds.size > 0) {
          retainSelection(retryBookIds);
        } else {
          leaveSelectionMode();
        }
      } catch (error) {
        pushFeedback({
          id: "bulk-action",
          tone: "error",
          title: `${label} could not start.`,
          detail: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setIsBulkRunning(false);
      }
    },
    [
      books,
      dismissFeedback,
      isBulkRunning,
      leaveSelectionMode,
      pushFeedback,
      retainSelection,
      selectedBookIds,
    ],
  );

  const handleBulkAction = useCallback(
    (action: LibraryBulkAction) => {
      if (action === "move") return dialogs.openBulkMove();
      if (action === "delete") return dialogs.openBulkDelete();
      if (action === "edit-metadata") return dialogs.openBulkMetadata();
      if (action === "favorite") {
        void runBulkAction("Add to favorites", (ids) => storage.bulkSetFavorite(ids, true));
      }
      if (action === "unfavorite") {
        void runBulkAction("Remove from favorites", (ids) => storage.bulkSetFavorite(ids, false));
      }
      if (action === "metadata") {
        void runBulkAction("Metadata re-extraction", (ids) => storage.bulkReextractMetadata(ids));
      }
      if (action === "covers") {
        void runBulkAction("Cover regeneration", (ids) => storage.bulkRegenerateCovers(ids));
      }
      if (action === "export") {
        void import("@tauri-apps/plugin-dialog").then(async ({ open }) => {
          const destination = await open({
            directory: true,
            multiple: false,
            title: "Export selected EPUBs",
          });
          if (typeof destination === "string") {
            await runBulkAction("Export", (ids) => storage.bulkExportBooks(ids, destination));
          }
        });
      }
    },
    [dialogs, runBulkAction, storage],
  );

  const moveSelectedBooks = useCallback(
    (folderId: string | null) =>
      runBulkAction("Move", (ids) => storage.bulkMoveBooksToFolder(ids, folderId)),
    [runBulkAction, storage],
  );
  const deleteSelectedBooks = useCallback(async () => {
    await runBulkAction("Delete", (ids) => storage.bulkDeleteBooks(ids));
    dialogs.close();
  }, [dialogs, runBulkAction, storage]);
  const writeSelectedBookMetadata = useCallback(
    (edits: BulkMetadataEditInput) =>
      runBulkAction("Metadata update", (ids) => storage.bulkWriteBookMetadata(ids, edits)),
    [runBulkAction, storage],
  );

  return {
    deleteSelectedBooks,
    handleBulkAction,
    isBulkRunning,
    moveSelectedBooks,
    selectedBooks,
    writeSelectedBookMetadata,
  };
}
