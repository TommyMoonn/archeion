import { invoke } from "@tauri-apps/api/core";
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
import { useAppPreferences } from "../../stores/appPreferencesStore";
import { vaultStore } from "../../stores/vaultStore";
import type { Book, UpdateBookInput } from "../../types/book";
import type { Folder } from "../../types/folder";
import { measurePerformance } from "../../utils/measurePerformance";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
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
import { SettingsDialog } from "../settings/SettingsDialog";
import { AboutDialog } from "../settings/AboutDialog";
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
  const preferences = useAppPreferences();
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
  const [clearProgressTarget, setClearProgressTarget] =
    useState<Book | null>(null);
  const [changeArchiveOpen, setChangeArchiveOpen] = useState(false);
  const [rescanConfirmationOpen, setRescanConfirmationOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [renameFolderTarget, setRenameFolderTarget] =
    useState<Folder | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<Folder | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 150);

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
  const favoriteCount = useMemo(
    () => books?.filter((book) => book.isFavorite).length ?? 0,
    [books],
  );
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
  const continuePreview = useMemo(
    () => continueBooks.slice(0, 5),
    [continueBooks],
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
    () =>
      measurePerformance("archeion:filter-and-sort-library", () =>
        getVisibleBooks(
          books ?? [],
          debouncedQuery,
          sort,
          location,
          folders,
        ),
      ),
    [books, debouncedQuery, folders, location, sort],
  );
  const selectedBook = useMemo(
    () => books?.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId],
  );
  const metadataEditBook = useMemo(
    () => books?.find((book) => book.id === metadataEditBookId) ?? null,
    [books, metadataEditBookId],
  );
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

  const changeLocation = useCallback((nextLocation: LibraryLocation) => {
    setLocation(nextLocation);
    if (nextLocation.type === "continue") {
      setSort("recently-opened");
    }
  }, []);

  const requestDelete = useCallback((book: Book) => {
    setSelectedBookId(null);
    setDeleteTarget(book);
  }, []);

  const requestClearProgress = useCallback((book: Book) => {
    setSelectedBookId(null);
    setClearProgressTarget(book);
  }, []);

  const openMetadataEdit = useCallback((book: Book) => {
    setSelectedBookId(null);
    setMetadataEditBookId(book.id);
  }, []);

  function closeMetadataEdit() {
    const bookId = metadataEditBookId;
    setMetadataEditBookId(null);
    setSelectedBookId(bookId);
  }

  const readBook = useCallback((book: Book) => {
    void navigate(`/reader/${book.id}`);
  }, [navigate]);

  const readBookFromBeginning = useCallback((book: Book) => {
    void navigate(`/reader/${book.id}?start=beginning`);
  }, [navigate]);

  const selectBook = useCallback((book: Book) => {
    setSelectedBookId(book.id);
  }, []);

  const openChangeArchive = useCallback(() => setChangeArchiveOpen(true), []);
  const openCreateFolder = useCallback(
    () => setIsCreateFolderOpen(true),
    [],
  );
  const openAbout = useCallback(() => setAboutOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  async function rescanLibrary() {
    setLibraryError(null);

    try {
      await storage.rescan();
    } catch {
      setLibraryError("The library folder could not be scanned.");
    }
  }

  async function clearProgress() {
    if (!clearProgressTarget || isDeleting) return;

    setIsDeleting(true);
    setLibraryError(null);
    try {
      await storage.updateBook(clearProgressTarget.id, {
        progressCfi: undefined,
        progressPercent: 0,
        lastOpenedAt: undefined,
      });
      setSelectedBookId(clearProgressTarget.id);
      setClearProgressTarget(null);
    } catch {
      setLibraryError("Reading progress could not be cleared.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function changeArchive() {
    setChangeArchiveOpen(false);
    await vaultStore.chooseVault();
  }

  async function revealBookFile(book: Book) {
    if (!book.relativePath) return;
    setLibraryError(null);
    try {
      await invoke("reveal_epub_file", { relativePath: book.relativePath });
    } catch {
      setLibraryError("The EPUB could not be revealed in its folder.");
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

  const toggleFavorite = useCallback(async (book: Book) => {
    setLibraryError(null);

    try {
      await storage.updateBook(book.id, {
        isFavorite: !book.isFavorite,
      });
    } catch {
      setLibraryError("Favorite status could not be updated.");
    }
  }, [storage]);

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
        description: "Mark books as favorites to keep them here.",
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
        title: "No books in this folder",
        description:
          storage.source === "vault"
            ? "EPUB files in this folder will appear here."
            : "Add books to this folder from book details.",
      };
    }

    return {
      title: storage.source === "vault" ? "No EPUB files found" : "No books yet",
      description:
        storage.source === "vault"
          ? "Add EPUB files to this library folder, then rescan."
          : "Add an EPUB or drop files here to start your collection.",
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
          archivePath={vault.status === "ready" ? vault.path : ""}
          canManageFolders={storage.source !== "vault"}
          onChangeArchive={openChangeArchive}
          onCreateFolder={openCreateFolder}
          onDeleteFolder={setDeleteFolderTarget}
          onLocationChange={changeLocation}
          onOpenAbout={openAbout}
          onOpenSettings={openSettings}
          onRenameFolder={setRenameFolderTarget}
        />
      }
    >
      <ImportDropzone
        disabled={isImporting || storage.source === "vault"}
        onFiles={handleFiles}
      >
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
                  ? "One file could not be added."
                  : `${failedImports.length} files could not be added.`}
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
          {location.type === "library" &&
          !query &&
          preferences.showContinueReading ? (
            <ContinueReading
              books={continuePreview}
              onContinue={readBook}
            />
          ) : null}
          {books === undefined || (isImporting && books.length === 0) ? (
            <div className="library-loading" role="status">
              <span className="library-loading__cover" />
              <span>
                {isImporting ? "Adding EPUB files" : "Loading library"}
              </span>
            </div>
          ) : visibleBooks.length === 0 && !debouncedQuery ? (
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
              onSelect={selectBook}
              onToggleFavorite={toggleFavorite}
            />
          ) : (
            <BookList
              books={visibleBooks}
              canDelete={storage.source !== "vault"}
              onDelete={requestDelete}
              onRead={readBook}
              onSelect={selectBook}
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
          canRevealFile={storage.source === "vault"}
          onClose={closeDetails}
          onClearProgress={requestClearProgress}
          onDelete={requestDelete}
          onEdit={openMetadataEdit}
          onRead={readBook}
          onReadFromBeginning={readBookFromBeginning}
          onRevealFile={(book) => void revealBookFile(book)}
          onRescan={() => {
            setSelectedBookId(null);
            setRescanConfirmationOpen(true);
          }}
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

      {settingsOpen ? (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      ) : null}
      {aboutOpen ? (
        <AboutDialog onClose={() => setAboutOpen(false)} />
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
              ? "Remove book metadata?"
              : "Delete EPUB file?"
          }
          description={
            deleteTarget.isFileMissing
              ? `Favorites, progress, and display metadata for “${deleteTarget.displayTitle ?? deleteTarget.originalTitle}” will be removed. No EPUB file will be deleted.`
              : `The stored EPUB for “${deleteTarget.displayTitle ?? deleteTarget.originalTitle}” and its reading data will be permanently deleted from this device.`
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
                    : "Delete EPUB"}
              </Button>
            </>
          }
        />
      ) : null}

      {clearProgressTarget ? (
        <Dialog
          title="Clear reading progress?"
          description={`The saved reading position for “${clearProgressTarget.displayTitle ?? clearProgressTarget.originalTitle}” will be removed. The EPUB file is not changed.`}
          onClose={() => {
            if (!isDeleting) {
              setSelectedBookId(clearProgressTarget.id);
              setClearProgressTarget(null);
            }
          }}
          footer={
            <>
              <Button
                disabled={isDeleting}
                onClick={() => {
                  setSelectedBookId(clearProgressTarget.id);
                  setClearProgressTarget(null);
                }}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={isDeleting}
                onClick={() => void clearProgress()}
                variant="danger"
              >
                {isDeleting ? "Clearing" : "Clear progress"}
              </Button>
            </>
          }
        />
      ) : null}

      {changeArchiveOpen ? (
        <Dialog
          title="Change library folder?"
          description="You’ll switch to another local folder. The current folder and its metadata will remain unchanged."
          onClose={() => setChangeArchiveOpen(false)}
          footer={
            <>
              <Button
                onClick={() => setChangeArchiveOpen(false)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button autoFocus onClick={() => void changeArchive()}>
                Choose folder
              </Button>
            </>
          }
        />
      ) : null}

      {rescanConfirmationOpen ? (
        <Dialog
          title="Rescan library?"
          description="This refreshes book and missing-file records. EPUB files are not changed."
          onClose={() => setRescanConfirmationOpen(false)}
          footer={
            <>
              <Button
                onClick={() => setRescanConfirmationOpen(false)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                autoFocus
                onClick={() => {
                  setRescanConfirmationOpen(false);
                  void rescanLibrary();
                }}
              >
                Rescan library
              </Button>
            </>
          }
        />
      ) : null}

      {deleteFolderTarget ? (
        <Dialog
          title="Delete this folder?"
          description={`The “${deleteFolderTarget.name}” folder record will be removed. Its EPUB files will remain in Library.`}
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
