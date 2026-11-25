import { useState } from "react";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { LibraryDuplicatesView } from "../../../src/features/library/LibraryDuplicatesView";
import { LibraryEpubIssuesView } from "../../../src/features/library/LibraryEpubIssuesView";
import type { LibraryStorage } from "../../../src/storage/LibraryStorage";
import { LibraryStorageContext } from "../../../src/storage/useLibraryStorage";
import type { Book, ReadonlyBook } from "../../../src/types/book";
import type {
  EpubDiagnosticAnalysisResult,
  EpubDuplicateAnalysisResult,
} from "../../../src/types/epubIntegrity";

const date = "2026-08-13T00:00:00.000Z";
const longPath = `OPS/${"long-resource-name".repeat(14)}.xhtml`;
const books = ["Alpha", "Alpha copy", "Beta", "Beta copy"].map((title, index): Book => ({
  id: `book-${index}`,
  fileName: `${title}.epub`,
  relativePath: `Shelf/${title}.epub`,
  addedAt: date,
  modifiedAt: date,
  updatedAt: date,
  isFavorite: false,
  originalTitle: title,
  sourceMetadata: { creator: "Ada", title },
  size: 128,
}));
const signature = { modifiedAtMillis: Date.parse(date), sizeBytes: 128 };
const duplicates: EpubDuplicateAnalysisResult = {
  archiveGeneration: 1,
  requestRevision: 1,
  signatures: Object.fromEntries(books.map((book) => [book.relativePath!, signature])),
  groups: [
    {
      kind: "exact",
      identity: "sha256:1234567890abcdefghijklmnopqrstuvwxyz",
      members: books.slice(0, 2).map((book) => book.relativePath!),
    },
    {
      kind: "probable",
      identity: "urn:shared",
      members: books.slice(2).map((book) => book.relativePath!),
    },
  ],
};
const diagnostics: EpubDiagnosticAnalysisResult = {
  archiveGeneration: 1,
  requestRevision: 1,
  entries: books.map((book, index) => ({
    relativePath: book.relativePath!,
    signature,
    source: "computed",
    diagnostics: {
      formatVersion: 1,
      issues:
        index === 0
          ? [
              {
                code: "broken-local-document-target",
                severity: "warning",
                messageInputs: { href: longPath },
                resourcePath: longPath,
              },
            ]
          : [{ code: "unreadable-zip", severity: "error" }],
    },
  })),
};
const storage = { loadBookCover: async () => undefined } as unknown as LibraryStorage;

export function IntegrityFixture() {
  const [action, setAction] = useState("");
  const params = new URLSearchParams(location.search);
  const error = params.has("error");
  const noop = (book: ReadonlyBook) => setAction(book.id);
  const shared = {
    books,
    onOpenDetails: noop,
    onRead: noop,
    onReveal: noop,
    onRefresh: async () => true,
  };
  return (
    <LibraryStorageContext.Provider value={storage}>
      <TooltipProvider>
        <main style={{ padding: 20 }}>
          {params.get("view") === "integrity-duplicates" ? (
            <LibraryDuplicatesView
              {...shared}
              onDelete={noop}
              onMove={noop}
              state={{
                status: error ? "error" : "ready",
                snapshot: duplicates,
                error: error ? { operation: "duplicates", message: "Refresh failed." } : null,
              }}
            />
          ) : (
            <LibraryEpubIssuesView
              {...shared}
              state={{
                status: error ? "error" : "ready",
                snapshot: diagnostics,
                error: error ? { operation: "diagnostics", message: "Refresh failed." } : null,
              }}
            />
          )}
          <output>{action}</output>
        </main>
      </TooltipProvider>
    </LibraryStorageContext.Provider>
  );
}
