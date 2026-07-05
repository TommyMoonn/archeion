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
import { FolderBrowser } from "../folders/FolderBrowser";
import { FolderRenameDialog } from "../folders/FolderRenameDialog";
import { ImportDropzone } from "../import/ImportDropzone";
import {
  createImportEpubDependencies,
  importEpubFiles,
  type ImportResult,
} from "../import/importEpub";
import { useVault } from "../vault/useVault";
import { VaultStatusBar } from "../vault/VaultStatusBar";
import { BookDetailsDrawer } from "./BookDetailsDrawer";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import { BookMetadataDialog } from "./BookMetadataDialog";
import { ContinueReading } from "./ContinueReading";
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
  const vault = useVault();
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
  const [metadataEditBookId, setMetadataEditBookId] =
    useState<string | null>(null);
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
  const continueBooks = useMemo(
    () =>
      [...(books ?? [])]
        .filter(
          (book) =>
            (book.progressPercent ?? 0) > 0 &&
            (book.progressPercent ?? 0) < 99.5,
        )
        .sort((left, right) =>
          (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? ""),
        ),
    [books],
  );
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
    () => getVisibleBooks(books ?? [], query, sort, location, folders),
    [books, folders, location, query, sort],
  );
  const selectedBook =
    books?.find((book) => book.id === selectedBookId) ?? null;
  const metadataEditBook =
    books?.find((book) => book.id === metadataEditBookId) ?? null;
  const closeDetails = useCallback(() => setSelectedBookId(null), []);
  const currentFolder =
    location.type === "folder"
      ? folders?.find((folder) => folder.id === location.folderId)
      : undefined;
  const libraryTitle =
    location.type === "favorites"
      ? "Favorites"
      : location.type === "continue"
        ? "Continue reading"
        : currentFolder?.name ?? "Library";

  function changeLocation(nextLocation: LibraryLocation) {
    setLocation(nextLocation);
    if (nextLocation.type === "continue") {
      setSort("recently-opened");
    }
  }

  function requestDelete(book: Book) {
    setSelectedBookId(null);
    setDeleteTarget(book);
  }

  function openMetadataEdit(book: Book) {
    setSelectedBookId(null);
    setMetadataEditBookId(book.id);
  }

  function closeMetadataEdit() {
    const bookId = metadataEditBookId;
    setMetadataEditBookId(null);
    setSelectedBookId(bookId);
  }

  function readBook(book: Book) {
    void navigate(`/reader/${book.id}`);
  }

  function readBookFromBeginning(book: Book) {
    void navigate(`/reader/${book.id}?start=beginning`);
  }

  async function rescanLibrary() {
    setLibraryError(null);

    try {
      await storage.rescan();
    } catch {
      setLibraryError("The library folder could not be scanned.");
    }
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
      setLibraryError(
        deleteTarget.isFileMissing
          ? "The saved metadata could not be removed."
          : "This book could not be deleted. Please try again.",
      );
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

    if (location.type === "continue") {
      return {
        title: "No books in progress",
        description: "Books you start reading will appear here.",
      };
    }

    if (location.type === "folder") {
      return {
        title: "This folder is empty",
        description: "Move books here from their details.",
      };
    }

    return {
      title: storage.source === "vault" ? "No EPUB files found" : "No books yet",
      description:
        storage.source === "vault"
          ? "Add EPUB files to this library folder, then rescan."
          : "Import an EPUB or drop files here to start your collection.",
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
          continueCount={continueBooks.length}
          folders={folders ?? []}
          location={location}
          canManageFolders={storage.source !== "vault"}
          onCreateFolder={() => setIsCreateFolderOpen(true)}
          onDeleteFolder={setDeleteFolderTarget}
          onLocationChange={changeLocation}
          onRenameFolder={setRenameFolderTarget}
        />
      }
    >
      <ImportDropzone
        disabled={isImporting || storage.source === "vault"}
        onFiles={handleFiles}
      >
        {vault.status === "ready" ? (
          <VaultStatusBar path={vault.path} />
        ) : null}
        {location.type === "folders" ? (
          <FolderBrowser
            bookCounts={bookCountsByFolder}
            folders={folders ?? []}
            onOpen={(folder) =>
              changeLocation({ type: "folder", folderId: folder.id })
            }
          />
        ) : (
          <>
        <LibraryToolbar
          isImporting={isImporting}
          onFiles={handleFiles}
          onQueryChange={setQuery}
          onRescanError={() =>
            setLibraryError("The library folder could not be scanned.")
          }
          onSortChange={setSort}
          onViewChange={setView}
          query={query}
          sort={sort}
          title={libraryTitle}
          view={view}
          storageSource={storage.source}
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
          {location.type === "library" && !query ? (
            <ContinueReading
              books={continueBooks.slice(0, 5)}
              onContinue={readBook}
            />
          ) : null}
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
              description="Try another title, author, or folder name."
              icon={<BookOpenText size={42} weight="thin" />}
              title="No search results"
            />
          ) : view === "grid" ? (
            <BookGrid
              books={visibleBooks}
              canDelete={storage.source !== "vault"}
              onDelete={requestDelete}
              onRead={readBook}
              onSelect={(book) => setSelectedBookId(book.id)}
              onToggleFavorite={toggleFavorite}
            />
          ) : (
            <BookList
              books={visibleBooks}
              canDelete={storage.source !== "vault"}
              onDelete={requestDelete}
              onRead={readBook}
              onSelect={(book) => setSelectedBookId(book.id)}
              onToggleFavorite={toggleFavorite}
            />
          )}
        </div>
          </>
        )}
      </ImportDropzone>

      {selectedBook ? (
        <BookDetailsDrawer
          book={selectedBook}
          canManageFile={storage.source !== "vault"}
          onClose={closeDetails}
          onDelete={requestDelete}
          onEdit={openMetadataEdit}
          onRead={readBook}
          onReadFromBeginning={readBookFromBeginning}
          onRescan={() => void rescanLibrary()}
          onToggleFavorite={toggleFavorite}
        />
      ) : null}

      {metadataEditBook ? (
        <BookMetadataDialog
          book={metadataEditBook}
          onClose={closeMetadataEdit}
          onSave={saveBook}
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
          title={
            deleteTarget.isFileMissing
              ? "Remove saved metadata?"
              : "Delete this book?"
          }
          description={
            deleteTarget.isFileMissing
              ? `Saved details and reading progress for “${deleteTarget.displayTitle ?? deleteTarget.originalTitle}” will be removed.`
              : `“${deleteTarget.displayTitle ?? deleteTarget.originalTitle}” and its saved reading progress will be removed from this device.`
          }
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
                {isDeleting
                  ? "Removing"
                  : deleteTarget.isFileMissing
                    ? "Remove metadata"
                    : "Delete book"}
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
