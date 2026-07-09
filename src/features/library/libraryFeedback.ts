import type { ArchiveImportResult } from "../../storage/LibraryStorage";
import { summarizeArchiveImportResults } from "../filesystem/archiveImport";

export type LibraryFeedbackTone = "neutral" | "success" | "error";

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
export const LIBRARY_FEEDBACK_MAX_TOKENS = 3;

export const LIBRARY_FOLDER_FEEDBACK_IDS = {
  created: "library-folder-created",
} as const;

export const LIBRARY_DELETE_FEEDBACK_IDS = {
  bookDeleted: "library-delete-book",
  bookDeleteFailed: "library-error",
  folderDeleted: "library-delete-folder",
  folderDeleteFailed: "library-error",
  metadataRemoved: "library-delete-metadata",
  metadataRemoveFailed: "library-error",
} as const;

export function limitLibraryFeedbackTokens(
  tokens: LibraryFeedbackToken[],
): LibraryFeedbackToken[] {
  if (tokens.length <= LIBRARY_FEEDBACK_MAX_TOKENS) {
    return tokens;
  }

  const limitedTokens = [...tokens];

  while (limitedTokens.length > LIBRARY_FEEDBACK_MAX_TOKENS) {
    const oldestAutoDismissIndex = limitedTokens.findIndex(
      (token) => token.autoDismiss === true,
    );
    limitedTokens.splice(
      oldestAutoDismissIndex >= 0 ? oldestAutoDismissIndex : 0,
      1,
    );
  }

  return limitedTokens;
}

export function upsertLibraryFeedbackToken(
  tokens: LibraryFeedbackToken[],
  token: LibraryFeedbackToken,
): LibraryFeedbackToken[] {
  return limitLibraryFeedbackTokens([
    ...tokens.filter((candidate) => candidate.id !== token.id),
    token,
  ]);
}

export type LibraryDeleteSuccessFeedbackType =
  | "bookDeleted"
  | "folderDeleted"
  | "metadataRemoved";
export type LibraryDeleteErrorFeedbackType =
  | "bookDeleteFailed"
  | "folderDeleteFailed"
  | "metadataRemoveFailed";

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
): LibraryFeedbackToken {
  return {
    id: LIBRARY_DELETE_FEEDBACK_IDS[type],
    tone: "success",
    title: DELETE_SUCCESS_TITLES[type],
    autoDismiss: true,
  };
}

export function createDeleteErrorFeedbackToken(
  type: LibraryDeleteErrorFeedbackType,
): LibraryFeedbackToken {
  return {
    id: LIBRARY_DELETE_FEEDBACK_IDS[type],
    tone: "error",
    title: DELETE_ERROR_TITLES[type],
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
        result.message ?? (result.status === "skipped" ? "Skipped." : "Failed."),
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
      tone: "neutral",
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
