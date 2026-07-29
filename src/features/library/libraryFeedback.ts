import type {
  ArchiveImportResult,
  ArchiveOperationWarning,
  BulkActionResult,
} from "../../storage/LibraryStorage";
import { summarizeArchiveImportResults } from "../filesystem/archiveImport";

export type LibraryFeedbackTone = "success" | "warning" | "error";

export type LibraryFeedbackDetail = {
  label: string;
  message: string;
};

export type LibraryFeedbackToken = {
  id: string;
  tone: LibraryFeedbackTone;
  title: string;
  detail?: string;
  details?: LibraryFeedbackDetail[];
  autoDismiss?: boolean;
  autoDismissMs?: number;
};

export type LibraryFeedbackDraft = Omit<LibraryFeedbackToken, "id"> & {
  id?: string;
};

export const LIBRARY_FEEDBACK_AUTO_DISMISS_MS = 4_000;
export const LIBRARY_FEEDBACK_MAX_AUTO_DISMISS_TOKENS = 3;

export const LIBRARY_FOLDER_FEEDBACK_IDS = {
  created: "library-folder-created",
} as const;

export const LIBRARY_MUTATION_FEEDBACK_IDS = {
  bookMoved: "library-move-book",
  bookRenamed: "library-rename-book",
  folderMoved: "library-move-folder",
  folderRenamed: "library-rename-folder",
} as const;

export const LIBRARY_DELETE_FEEDBACK_IDS = {
  bookDeleted: "library-delete-book",
  bookDeleteFailed: "library-delete-book-error",
  folderDeleted: "library-delete-folder",
  folderDeleteFailed: "library-delete-folder-error",
  metadataRemoved: "library-delete-metadata",
  metadataRemoveFailed: "library-delete-metadata-error",
} as const;

export function limitLibraryFeedbackTokens(tokens: LibraryFeedbackToken[]): LibraryFeedbackToken[] {
  const autoDismissIds = new Set(
    tokens
      .filter((token) => token.autoDismiss === true)
      .slice(-LIBRARY_FEEDBACK_MAX_AUTO_DISMISS_TOKENS)
      .map((token) => token.id),
  );

  return tokens.filter((token) => token.autoDismiss !== true || autoDismissIds.has(token.id));
}

export function upsertLibraryFeedbackToken(
  tokens: LibraryFeedbackToken[],
  token: LibraryFeedbackToken,
): LibraryFeedbackToken[] {
  const existingToken = tokens.find((candidate) => candidate.id === token.id);
  if (existingToken && libraryFeedbackTokensEqual(existingToken, token)) {
    return tokens;
  }

  return limitLibraryFeedbackTokens([
    ...tokens.filter((candidate) => candidate.id !== token.id),
    token,
  ]);
}

function libraryFeedbackTokensEqual(
  left: LibraryFeedbackToken,
  right: LibraryFeedbackToken,
): boolean {
  if (
    left.id !== right.id ||
    left.tone !== right.tone ||
    left.title !== right.title ||
    left.detail !== right.detail ||
    left.autoDismiss !== right.autoDismiss ||
    left.autoDismissMs !== right.autoDismissMs ||
    left.details?.length !== right.details?.length
  ) {
    return false;
  }

  return (left.details ?? []).every(
    (detail, index) =>
      detail.label === right.details?.[index]?.label &&
      detail.message === right.details[index]?.message,
  );
}

export type LibraryDeleteSuccessFeedbackType = "bookDeleted" | "folderDeleted" | "metadataRemoved";
export type LibraryDeleteErrorFeedbackType =
  "bookDeleteFailed" | "folderDeleteFailed" | "metadataRemoveFailed";

const DELETE_SUCCESS_TITLES: Record<LibraryDeleteSuccessFeedbackType, string> = {
  bookDeleted: "EPUB deleted.",
  folderDeleted: "Folder deleted.",
  metadataRemoved: "Metadata removed.",
};

const DELETE_ERROR_TITLES: Record<LibraryDeleteErrorFeedbackType, string> = {
  bookDeleteFailed: "This book could not be deleted.",
  folderDeleteFailed: "This folder could not be deleted.",
  metadataRemoveFailed: "The saved metadata could not be removed.",
};

export type LibraryMutationSuccessFeedbackType = keyof typeof LIBRARY_MUTATION_FEEDBACK_IDS;
export type LibraryBulkFeedbackAction =
  | "Add to favorites"
  | "Remove from favorites"
  | "Move"
  | "Delete"
  | "Metadata update"
  | "Metadata re-extraction"
  | "Cover regeneration"
  | "Export";

const MUTATION_SUCCESS_TITLES: Record<LibraryMutationSuccessFeedbackType, string> = {
  bookMoved: "EPUB moved.",
  bookRenamed: "EPUB file renamed.",
  folderMoved: "Folder moved.",
  folderRenamed: "Folder renamed.",
};

type LibraryBulkFeedbackCopy = Readonly<{
  failed: string;
  skipped: string;
}>;

const BULK_FEEDBACK_COPY: Record<LibraryBulkFeedbackAction, LibraryBulkFeedbackCopy> = {
  "Add to favorites": {
    failed: "This book could not be added to Favorites. Try again.",
    skipped: "This book was not added to Favorites. Try again.",
  },
  "Remove from favorites": {
    failed: "This book could not be removed from Favorites. Try again.",
    skipped: "This book was not removed from Favorites. Try again.",
  },
  Move: {
    failed: "This EPUB could not be moved. Check that the archive is writable, then try again.",
    skipped: "This EPUB was not moved. Check that it is available, then try again.",
  },
  Delete: {
    failed: "This EPUB could not be deleted. Check that the file is available, then try again.",
    skipped: "This EPUB was not deleted. Check that the file is available, then try again.",
  },
  "Metadata update": {
    failed: "Metadata could not be updated for this book. Try again.",
    skipped: "Metadata was not updated for this book. Try again.",
  },
  "Metadata re-extraction": {
    failed: "Metadata could not be re-extracted for this book. Try again.",
    skipped: "Metadata was not re-extracted for this book. Try again.",
  },
  "Cover regeneration": {
    failed: "The cover could not be regenerated for this book. Try again.",
    skipped: "The cover was not regenerated for this book. Try again.",
  },
  Export: {
    failed: "This EPUB could not be exported. Check the destination folder and try again.",
    skipped: "This EPUB was not exported. Check the destination folder and try again.",
  },
};

const BULK_SKIP_REASON_COPY: Readonly<Record<string, string>> = {
  "The book is no longer in the library.": "This book is no longer in the Library.",
  "The EPUB file is unavailable.": "This EPUB is unavailable. Rescan the Library to update it.",
  "The book is already in this folder.": "This EPUB is already in the selected folder.",
  "Already a favorite.": "This book is already in Favorites.",
  "Not a favorite.": "This book is not in Favorites.",
  "The selected metadata is already applied.": "The selected metadata is already applied.",
};

const MISSING_BOOK_LABEL = "Book no longer in Library";

export function createArchiveOperationWarningFeedbackToken(
  warning: ArchiveOperationWarning,
): LibraryFeedbackToken {
  const occurrences = warning.occurrences ?? 1;
  const isArchiveMetadataRecovery = warning.kind === "archive-metadata";
  const detail = isArchiveMetadataRecovery
    ? warning.repairRequired
      ? "A file operation completed, but archive metadata cleanup is still required. Run Archive metadata repair from Settings."
      : "A file operation completed with a cleanup warning. Check the original file if the operation used Move."
    : warning.repairRequired
      ? "Scanner-cache maintenance was delayed. Run Archive metadata repair from Settings."
      : occurrences > 1
        ? `Scanner-cache maintenance was delayed for ${occurrences} operations. The cache will rebuild automatically.`
        : "Scanner-cache maintenance was delayed. The cache will rebuild automatically.";
  const title = isArchiveMetadataRecovery
    ? warning.repairRequired
      ? "Archive metadata cleanup is required."
      : occurrences > 1
        ? "Some original EPUBs could not be removed."
        : "The original EPUB could not be removed."
    : warning.repairRequired
      ? "Archive metadata repair is required."
      : "Archive cache will be rebuilt.";
  return {
    id: isArchiveMetadataRecovery ? "archive-metadata-warning" : "scanner-cache-warning",
    tone: "warning",
    title,
    detail,
    autoDismiss: !warning.repairRequired,
  };
}

export function createFolderSuccessFeedbackToken(): LibraryFeedbackToken {
  return {
    id: LIBRARY_FOLDER_FEEDBACK_IDS.created,
    tone: "success",
    title: "Folder created.",
    autoDismiss: true,
  };
}

export function createDeleteSuccessFeedbackToken(
  type: LibraryDeleteSuccessFeedbackType,
  id: string = LIBRARY_DELETE_FEEDBACK_IDS[type],
): LibraryFeedbackToken {
  return {
    id,
    tone: "success",
    title: DELETE_SUCCESS_TITLES[type],
    autoDismiss: true,
  };
}

export function createDeleteErrorFeedbackToken(
  type: LibraryDeleteErrorFeedbackType,
  id: string = LIBRARY_DELETE_FEEDBACK_IDS[type],
): LibraryFeedbackToken {
  return {
    id,
    tone: "error",
    title: DELETE_ERROR_TITLES[type],
  };
}

export function createMutationSuccessFeedbackToken(
  type: LibraryMutationSuccessFeedbackType,
): LibraryFeedbackToken {
  return {
    autoDismiss: true,
    id: LIBRARY_MUTATION_FEEDBACK_IDS[type],
    tone: "success",
    title: MUTATION_SUCCESS_TITLES[type],
  };
}

export function createImportFeedbackToken(
  id: string,
  results: ArchiveImportResult[],
): LibraryFeedbackToken | null {
  const summary = summarizeArchiveImportResults(results);

  if (!summary) {
    return null;
  }

  const details = results
    .filter((result) => result.status !== "imported")
    .map((result) => ({
      label: result.fileName,
      message:
        result.status === "skipped"
          ? "EPUB was skipped because of the selected conflict setting."
          : "EPUB could not be added. Check that the source file is available and the archive is writable, then try again.",
    }));

  if (summary.failed > 0) {
    return {
      id,
      tone: "error",
      title: "Some EPUBs could not be added.",
      detail: summary.message,
      details,
    };
  }

  if (summary.skipped > 0) {
    return {
      id,
      tone: "warning",
      title: "Some EPUBs were skipped.",
      detail: summary.message,
      details,
    };
  }

  return {
    id,
    tone: "success",
    title: summary.imported === 1 ? "EPUB added." : "EPUBs added.",
    detail: summary.message,
    autoDismiss: true,
  };
}

export function createBulkActionFeedbackToken(
  action: LibraryBulkFeedbackAction,
  result: BulkActionResult,
  bookLabels: ReadonlyMap<string, string>,
): LibraryFeedbackToken {
  const copy = BULK_FEEDBACK_COPY[action];
  const detail = `${result.succeeded.length} succeeded, ${result.failed.length} failed, ${result.skipped.length} skipped.`;
  const details = [
    ...result.failed.map(({ bookId }) => ({
      label: bookLabels.get(bookId) ?? MISSING_BOOK_LABEL,
      message: copy.failed,
    })),
    ...result.skipped.map(({ bookId, reason }) => ({
      label: bookLabels.get(bookId) ?? MISSING_BOOK_LABEL,
      message: BULK_SKIP_REASON_COPY[reason] ?? copy.skipped,
    })),
  ];
  return {
    id: "bulk-action",
    tone: result.failed.length ? "error" : result.skipped.length ? "warning" : "success",
    title: result.failed.length ? `${action} completed with errors.` : `${action} complete.`,
    detail,
    details,
    autoDismiss: details.length === 0,
  };
}
