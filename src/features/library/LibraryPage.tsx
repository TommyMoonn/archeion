import { BookOpenText, WarningCircle, X } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { PageShell } from "../../components/PageShell";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import type { Book, UpdateBookInput } from "../../types/book";
import type { Folder } from "../../types/folder";
import { FolderCreateDialog } from "../folders/FolderCreateDialog";
import { FolderRenameDialog } from "../folders/FolderRenameDialog";
import { ImportDropzone } from "../import/ImportDropzone";
import {
  createImportEpubDependencies,
  importEpubFiles,
  type ImportResult,
} from "../import/importEpub";
import { BookDetailsDrawer } from "./BookDetailsDrawer";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import {
  getVisibleBooks,
  type LibraryLocation,
  type LibrarySort,
} from "./libraryFilters";
import { LibrarySidebar } from "./LibrarySidebar";
import {
  LibraryToolbar,
  type LibraryView,
} from "./LibraryToolbar";

type FailedImport = Extract<ImportResult, { status: "failed" }>;

export function LibraryPage() {
  const navigate = useNavigate();
  const storage = useLibraryStorage();
  const [books, setBooks] = useState<Book[] | undefined>();
  const [folders, setFolders] = useState<Folder[] | undefined>();
  const importLock = useRef(false);
  const [isImporting, setIsImporting] = useState(false);
  const [failedImports, setFailedImports] = useState<FailedImport[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("recently-added");
  const [view, setView] = useState<LibraryView>("grid");
  const [location, setLocation] = useState<LibraryLocation>({
    type: "library",
  });
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [renameFolderTarget, setRenameFolderTarget] =
    useState<Folder | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<Folder | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const handleStorageError = () => {
      setLibraryError("The local library could not be loaded.");
    };
    const stopBooks = storage.observeBooks({
      next: setBooks,
      error: handleStorageError,
    });
    const stopFolders = storage.observeFolders({
      next: setFolders,
      error: handleStorageError,
    });

    return () => {
      stopBooks();
      stopFolders();
    };
  }, [storage]);

  async function handleFiles(files: File[]) {
    if (importLock.current) {
      return;
    }

    importLock.current = true;
    setIsImporting(true);
    setFailedImports([]);

    try {
      const results = await importEpubFiles(
        files,
        createImportEpubDependencies(storage),
      );

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
  const favoriteCount =
    books?.filter((book) => book.isFavorite).length ?? 0;
  const bookCountsByFolder = useMemo(() => {
    const counts = new Map<string, number>();

    for (const book of books ?? []) {
      if (book.folderId) {
        counts.set(book.folderId, (counts.get(book.folderId) ?? 0) + 1);
      }
    }

    return counts;
  }, [books]);
  const visibleBooks = useMemo(
    () => getVisibleBooks(books ?? [], query, sort, location),
    [books, location, query, sort],
  );
  const selectedBook =
    books?.find((book) => book.id === selectedBookId) ?? null;
  const closeDetails = useCallback(() => setSelectedBookId(null), []);
  const currentFolder =
    location.type === "folder"
      ? folders?.find((folder) => folder.id === location.folderId)
      : undefined;
  const libraryTitle =
    location.type === "favorites"
      ? "Favorites"
      : currentFolder?.name ?? "Library";

  function changeLocation(nextLocation: LibraryLocation) {
    setLocation(nextLocation);
    setQuery("");
  }

  function requestDelete(book: Book) {
    setSelectedBookId(null);
    setDeleteTarget(book);
  }

  function readBook(book: Book) {
    void navigate(`/reader/${book.id}`);
  }

  async function confirmDelete() {
    if (!deleteTarget || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setLibraryError(null);

    try {
      await storage.deleteBook(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      setLibraryError("This book could not be deleted. Please try again.");
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  }

  async function toggleFavorite(book: Book) {
    setLibraryError(null);

    try {
      await storage.updateBook(book.id, {
        isFavorite: !book.isFavorite,
      });
    } catch {
      setLibraryError("Favorite status could not be updated.");
    }
  }

  async function saveBook(book: Book, changes: UpdateBookInput) {
    setLibraryError(null);

    try {
      await storage.updateBook(book.id, changes);
    } catch (error) {
      setLibraryError("Book details could not be updated.");
      throw error;
    }
  }

  async function createFolder(name: string) {
    await storage.createFolder({ name, parentId: null });
  }

  async function renameFolder(name: string) {
    if (!renameFolderTarget) {
      return;
    }

    await storage.updateFolder(renameFolderTarget.id, { name });
  }

  async function confirmDeleteFolder() {
    if (!deleteFolderTarget || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setLibraryError(null);

    try {
      await storage.deleteFolder(deleteFolderTarget.id);

      if (
        location.type === "folder" &&
        location.folderId === deleteFolderTarget.id
      ) {
        setLocation({ type: "library" });
      }

      setDeleteFolderTarget(null);
    } catch {
      setLibraryError("This folder could not be deleted. Please try again.");
      setDeleteFolderTarget(null);
    } finally {
      setIsDeleting(false);
    }
  }

  function locationEmptyState() {
    if (location.type === "favorites") {
      return {
        title: "No favorites yet",
        description: "Mark books as favorites to keep them close.",
      };
    }

    if (location.type === "folder") {
      return {
        title: "This folder is empty",
        description: "Move books here from their details.",
      };
    }

    return {
      title: "No books yet",
      description: "Import an EPUB or drop files here to start your collection.",
    };
  }

  const emptyState = locationEmptyState();

  return (
    <PageShell
      sidebar={
        <LibrarySidebar
          bookCount={bookCount}
          bookCountsByFolder={bookCountsByFolder}
          favoriteCount={favoriteCount}
          folders={folders ?? []}
          location={location}
          onCreateFolder={() => setIsCreateFolderOpen(true)}
          onDeleteFolder={setDeleteFolderTarget}
          onLocationChange={changeLocation}
          onRenameFolder={setRenameFolderTarget}
        />
      }
    >
      <ImportDropzone disabled={isImporting} onFiles={handleFiles}>
        <LibraryToolbar
          isImporting={isImporting}
          onFiles={handleFiles}
          onQueryChange={setQuery}
          onSortChange={setSort}
          onViewChange={setView}
          query={query}
          sort={sort}
          title={libraryTitle}
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
          ) : visibleBooks.length === 0 && !query ? (
            <EmptyState
              description={emptyState.description}
              icon={<BookOpenText size={42} weight="thin" />}
              title={emptyState.title}
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
              onRead={readBook}
              onSelect={(book) => setSelectedBookId(book.id)}
              onToggleFavorite={toggleFavorite}
            />
          ) : (
            <BookList
              books={visibleBooks}
              onDelete={requestDelete}
              onRead={readBook}
              onSelect={(book) => setSelectedBookId(book.id)}
              onToggleFavorite={toggleFavorite}
            />
          )}
        </div>
      </ImportDropzone>

      {selectedBook ? (
        <BookDetailsDrawer
          book={selectedBook}
          folders={folders ?? []}
          onClose={closeDetails}
          onDelete={requestDelete}
          onRead={readBook}
          onSave={saveBook}
          onToggleFavorite={toggleFavorite}
        />
      ) : null}

      {isCreateFolderOpen ? (
        <FolderCreateDialog
          onClose={() => setIsCreateFolderOpen(false)}
          onCreate={createFolder}
        />
      ) : null}

      {renameFolderTarget ? (
        <FolderRenameDialog
          folder={renameFolderTarget}
          onClose={() => setRenameFolderTarget(null)}
          onRename={renameFolder}
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

      {deleteFolderTarget ? (
        <Dialog
          title="Delete this folder?"
          description={`“${deleteFolderTarget.name}” will be removed. Its books will return to Library.`}
          onClose={() => {
            if (!isDeleting) {
              setDeleteFolderTarget(null);
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={isDeleting}
                onClick={() => setDeleteFolderTarget(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isDeleting}
                onClick={confirmDeleteFolder}
              >
                {isDeleting ? "Deleting" : "Delete folder"}
              </Button>
            </>
          }
        />
      ) : null}
    </PageShell>
  );
}
