import { BookOpenText, WarningCircle, X } from "@phosphor-icons/react";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { PageShell } from "../../components/PageShell";
import { bookRepository } from "../../db/bookRepository";
import { ImportDropzone } from "../import/ImportDropzone";
import {
  importEpubFiles,
  type ImportResult,
} from "../import/importEpub";
import { BookDetailsDrawer } from "./BookDetailsDrawer";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import {
  getVisibleBooks,
  type LibrarySort,
} from "./libraryFilters";
import { LibrarySidebar } from "./LibrarySidebar";
import {
  LibraryToolbar,
  type LibraryView,
} from "./LibraryToolbar";
import type { Book } from "../../types/book";

type FailedImport = Extract<ImportResult, { status: "failed" }>;

export function LibraryPage() {
  const books = useLiveQuery(() => bookRepository.list(), [], []);
  const importLock = useRef(false);
  const [isImporting, setIsImporting] = useState(false);
  const [failedImports, setFailedImports] = useState<FailedImport[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("recently-added");
  const [view, setView] = useState<LibraryView>("grid");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleFiles(files: File[]) {
    if (importLock.current) {
      return;
    }

    importLock.current = true;
    setIsImporting(true);
    setFailedImports([]);

    try {
      const results = await importEpubFiles(files);

      setFailedImports(
        results.filter(
          (result): result is FailedImport => result.status === "failed",
        ),
      );
    } finally {
      importLock.current = false;
      setIsImporting(false);
    }
  }

  const bookCount = books?.length ?? 0;
  const visibleBooks = useMemo(
    () => getVisibleBooks(books ?? [], query, sort),
    [books, query, sort],
  );
  const selectedBook =
    books?.find((book) => book.id === selectedBookId) ?? null;
  const closeDetails = useCallback(() => setSelectedBookId(null), []);

  function requestDelete(book: Book) {
    setSelectedBookId(null);
    setDeleteTarget(book);
  }

  async function confirmDelete() {
    if (!deleteTarget || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setLibraryError(null);

    try {
      await bookRepository.remove(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      setLibraryError("This book could not be deleted. Please try again.");
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <PageShell sidebar={<LibrarySidebar bookCount={bookCount} />}>
      <ImportDropzone disabled={isImporting} onFiles={handleFiles}>
        <LibraryToolbar
          isImporting={isImporting}
          onFiles={handleFiles}
          onQueryChange={setQuery}
          onSortChange={setSort}
          onViewChange={setView}
          query={query}
          sort={sort}
          view={view}
        />

        {libraryError ? (
          <div className="import-notice" role="alert">
            <WarningCircle aria-hidden="true" size={19} weight="regular" />
            <div>
              <p>{libraryError}</p>
            </div>
            <IconButton
              label="Dismiss library error"
              onClick={() => setLibraryError(null)}
            >
              <X aria-hidden="true" size={17} weight="regular" />
            </IconButton>
          </div>
        ) : null}

        {failedImports.length > 0 ? (
          <div className="import-notice" role="alert">
            <WarningCircle aria-hidden="true" size={19} weight="regular" />
            <div>
              <p>
                {failedImports.length === 1
                  ? "One file could not be imported."
                  : `${failedImports.length} files could not be imported.`}
              </p>
              <ul>
                {failedImports.map((result, index) => (
                  <li key={`${result.fileName}-${index}`}>
                    <span>{result.fileName}</span>
                    {result.message}
                  </li>
                ))}
              </ul>
            </div>
            <IconButton
              label="Dismiss import errors"
              onClick={() => setFailedImports([])}
            >
              <X aria-hidden="true" size={17} weight="regular" />
            </IconButton>
          </div>
        ) : null}

        <div className="library-content">
          {books === undefined || (isImporting && books.length === 0) ? (
            <div className="library-loading" role="status">
              <span className="library-loading__cover" />
              <span>
                {isImporting ? "Importing EPUB files" : "Loading library"}
              </span>
            </div>
          ) : books.length === 0 ? (
            <EmptyState
              description="Import an EPUB or drop files here to start your collection."
              icon={<BookOpenText size={42} weight="thin" />}
              title="No books yet"
            />
          ) : visibleBooks.length === 0 ? (
            <EmptyState
              action={
                <Button variant="secondary" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
              description="Try a different title or author."
              icon={<BookOpenText size={42} weight="thin" />}
              title="No matching books"
            />
          ) : view === "grid" ? (
            <BookGrid
              books={visibleBooks}
              onDelete={requestDelete}
              onSelect={(book) => setSelectedBookId(book.id)}
            />
          ) : (
            <BookList
              books={visibleBooks}
              onDelete={requestDelete}
              onSelect={(book) => setSelectedBookId(book.id)}
            />
          )}
        </div>
      </ImportDropzone>

      {selectedBook ? (
        <BookDetailsDrawer
          book={selectedBook}
          onClose={closeDetails}
          onDelete={requestDelete}
        />
      ) : null}

      {deleteTarget ? (
        <Dialog
          title="Delete this book?"
          description={`“${deleteTarget.displayTitle ?? deleteTarget.originalTitle}” and its saved reading progress will be removed from this device.`}
          onClose={() => {
            if (!isDeleting) {
              setDeleteTarget(null);
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isDeleting}
                onClick={confirmDelete}
              >
                {isDeleting ? "Deleting" : "Delete book"}
              </Button>
            </>
          }
        />
      ) : null}
    </PageShell>
  );
}
