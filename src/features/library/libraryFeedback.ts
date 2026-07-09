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
