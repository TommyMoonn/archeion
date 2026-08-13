import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type {
  EpubDiagnosticAnalysisEntry,
  EpubDiagnosticAnalysisResult,
  EpubDiagnosticCode,
} from "../../types/epubIntegrity";
import { libraryBookMatchesAnalysisSignature } from "./libraryIntegrityFiles";

const READER_BLOCKING_DIAGNOSTIC_CODES = new Set<EpubDiagnosticCode>([
  "unreadable-zip",
  "missing-container",
  "malformed-container",
  "missing-rootfile",
  "unsafe-rootfile",
  "missing-package-document",
  "malformed-package-document",
  "no-usable-reading-order",
]);

type EpubDiagnosticIssue = EpubDiagnosticAnalysisEntry["diagnostics"]["issues"][number];

function isReaderBlockingDiagnostic(issue: EpubDiagnosticIssue): boolean {
  return (
    READER_BLOCKING_DIAGNOSTIC_CODES.has(issue.code) ||
    (issue.code === "inspection-limit-exceeded" && issue.resourcePath === undefined)
  );
}

export type ResolvedEpubIssueBook = Readonly<{
  book: LibrarySnapshotBook;
  entry: EpubDiagnosticAnalysisEntry;
  errorCount: number;
  warningCount: number;
  readerAvailable: boolean;
}>;

export function resolveEpubIssueBooks(
  books: readonly LibrarySnapshotBook[],
  snapshot: EpubDiagnosticAnalysisResult | null,
): readonly ResolvedEpubIssueBook[] {
  if (!snapshot) return [];
  const booksByPath = new Map(
    books.flatMap((book) => (book.relativePath ? [[book.relativePath, book] as const] : [])),
  );

  return snapshot.entries.flatMap((entry) => {
    const book = booksByPath.get(entry.relativePath);
    if (
      !book ||
      entry.diagnostics.issues.length === 0 ||
      !libraryBookMatchesAnalysisSignature(book, entry.relativePath, entry.signature)
    ) {
      return [];
    }
    const errorCount = entry.diagnostics.issues.filter(
      (issue) => issue.severity === "error",
    ).length;
    const warningCount = entry.diagnostics.issues.length - errorCount;
    return [
      {
        book,
        entry,
        errorCount,
        warningCount,
        readerAvailable: !entry.diagnostics.issues.some(isReaderBlockingDiagnostic),
      },
    ];
  });
}

export function epubIssueBooks(
  books: readonly LibrarySnapshotBook[],
  snapshot: EpubDiagnosticAnalysisResult | null,
): readonly LibrarySnapshotBook[] {
  return resolveEpubIssueBooks(books, snapshot).map((resolved) => resolved.book);
}
