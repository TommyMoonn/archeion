import { useCallback, useMemo, useRef, useState } from "react";

import type {
  BulkActionResult,
  LibrarySnapshotBook,
  LibraryStorage,
} from "../../storage/LibraryStorage";
import type { BulkMetadataEditInput } from "../../types/book";
import { bookAuthor } from "../../utils/bookDisplay";
import { exportReaderAnnotationsToFile } from "../reader/readerAnnotationExportFile";
import type { ReaderAnnotationExportFormat } from "../reader/readerAnnotationExport";
import { bookTitle } from "./libraryFilters";
import {
  createBulkActionFeedbackToken,
  type LibraryBulkFeedbackAction,
  type LibraryFeedbackDraft,
} from "./libraryFeedback";
import type { LibraryWorkspaceDialogActions } from "./useLibraryWorkspaceDialogs";
import type { LibraryFeedbackOperation } from "./useLibraryFeedback";

type UseLibraryBulkActionsInput = {
  beginFeedbackOperation: (owner: string) => LibraryFeedbackOperation;
  books: readonly LibrarySnapshotBook[] | undefined;
  dialogs: LibraryWorkspaceDialogActions;
  dismissFeedback: (id: string) => void;
  leaveSelectionMode: () => void;
  publishFeedbackOperation: (
    operation: LibraryFeedbackOperation,
    feedback: LibraryFeedbackDraft,
  ) => boolean;
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
  | "annotations-markdown"
  | "annotations-json"
  | "export";

export function useLibraryBulkActions({
  beginFeedbackOperation,
  books,
  dialogs,
  dismissFeedback,
  leaveSelectionMode,
  publishFeedbackOperation,
  retainSelection,
  selectedBookIds,
  storage,
}: UseLibraryBulkActionsInput) {
  const bulkLockRef = useRef(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const selectedBooks = useMemo(
    () => (books ?? []).filter((book) => selectedBookIds.has(book.id)),
    [books, selectedBookIds],
  );

  const runBulkAction = useCallback(
    async (
      label: LibraryBulkFeedbackAction,
      action: (ids: readonly string[]) => Promise<BulkActionResult>,
    ) => {
      if (bulkLockRef.current) return;

      const ids = [...selectedBookIds];
      const labels = new Map((books ?? []).map((book) => [book.id, bookTitle(book)]));
      const feedbackOperation = beginFeedbackOperation("bulk-action");
      bulkLockRef.current = true;
      setIsBulkRunning(true);
      dismissFeedback("bulk-action");
      try {
        const result = await action(ids);
        publishFeedbackOperation(
          feedbackOperation,
          createBulkActionFeedbackToken(label, result, labels),
        );
        const retryBookIds = new Set([
          ...result.failed.map(({ bookId }) => bookId),
          ...result.skipped.map(({ bookId }) => bookId),
        ]);
        if (retryBookIds.size > 0) {
          retainSelection(retryBookIds);
        } else {
          leaveSelectionMode();
        }
      } catch {
        publishFeedbackOperation(feedbackOperation, {
          id: "bulk-action",
          tone: "error",
          title: `${label} could not start.`,
          detail: "Try the action again. If it continues to fail, rescan the Library.",
        });
      } finally {
        bulkLockRef.current = false;
        setIsBulkRunning(false);
      }
    },
    [
      books,
      beginFeedbackOperation,
      dismissFeedback,
      leaveSelectionMode,
      publishFeedbackOperation,
      retainSelection,
      selectedBookIds,
    ],
  );

  const runAnnotationExport = useCallback(
    async (format: ReaderAnnotationExportFormat) => {
      if (bulkLockRef.current) return;
      const feedbackOperation = beginFeedbackOperation("annotation-export");
      bulkLockRef.current = true;
      setIsBulkRunning(true);
      dismissFeedback("annotation-export");
      try {
        const exportBooks = await Promise.all(
          selectedBooks.map(async (book) => ({
            annotations: await storage.listAnnotations(book.id),
            author: bookAuthor(book),
            id: book.id,
            title: bookTitle(book),
          })),
        );
        const result = await exportReaderAnnotationsToFile({ books: exportBooks, format });
        if (result.status === "cancelled") return;
        if (result.status === "empty") {
          publishFeedbackOperation(feedbackOperation, {
            id: "annotation-export",
            tone: "warning",
            title: "No annotations to export.",
          });
          return;
        }
        publishFeedbackOperation(feedbackOperation, {
          autoDismiss: true,
          detail: `${result.annotationCount} ${result.annotationCount === 1 ? "annotation" : "annotations"} from ${result.bookCount} ${result.bookCount === 1 ? "book" : "books"}.`,
          id: "annotation-export",
          tone: "success",
          title: "Annotations exported.",
        });
      } catch {
        publishFeedbackOperation(feedbackOperation, {
          detail: "Try exporting the annotations again.",
          id: "annotation-export",
          tone: "error",
          title: "Annotations could not be exported.",
        });
      } finally {
        bulkLockRef.current = false;
        setIsBulkRunning(false);
      }
    },
    [beginFeedbackOperation, dismissFeedback, publishFeedbackOperation, selectedBooks, storage],
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
      if (action === "annotations-markdown") void runAnnotationExport("markdown");
      if (action === "annotations-json") void runAnnotationExport("json");
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
    [dialogs, runAnnotationExport, runBulkAction, storage],
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
