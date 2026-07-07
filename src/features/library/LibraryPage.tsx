import {
  BookOpenText,
  CheckCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  lazy,
  Suspense,
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
import type {
  AddArchiveEpubInput,
  ArchiveImportResult,
} from "../../storage/LibraryStorage";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import { useAppPreferences } from "../../stores/appPreferencesStore";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { measurePerformance } from "../../utils/measurePerformance";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { FolderBrowser } from "../folders/FolderBrowser";
import { summarizeArchiveImportResults } from "../filesystem/archiveImport";
import { ArchiveStatusBar } from "../archive/ArchiveStatusBar";
import { useArchive } from "../archive/useArchive";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import { ContinueReading } from "./ContinueReading";
import {
  bookTitle,
  createLibrarySearchIndex,
  getVisibleBooksFromSearchIndex,
  type LibraryLocation,
  type LibrarySort,
} from "./libraryFilters";
import { LibrarySidebar } from "./LibrarySidebar";
import { LibraryToolbar, type LibraryView } from "./LibraryToolbar";

const AddEpubDialog = lazy(() =>
  import("../filesystem/AddEpubDialog").then((module) => ({
    default: module.AddEpubDialog,
  })),
);
const MoveToFolderDialog = lazy(() =>
  import("../filesystem/MoveToFolderDialog").then((module) => ({
    default: module.MoveToFolderDialog,
  })),
);
const RenameFileDialog = lazy(() =>
  import("../filesystem/RenameFileDialog").then((module) => ({
    default: module.RenameFileDialog,
  })),
);
const AboutDialog = lazy(() =>
  import("../settings/AboutDialog").then((module) => ({
    default: module.AboutDialog,
  })),
);
const BookDetailsDrawer = lazy(() =>
  import("./BookDetailsDrawer").then((module) => ({
    default: module.BookDetailsDrawer,
  })),
);
const BookMetadataReferenceDialog = lazy(() =>
  import("./BookMetadataReferenceDialog").then((module) => ({
    default: module.BookMetadataReferenceDialog,
  })),
);
const FolderCreateDialog = lazy(() =>
  import("../folders/FolderCreateDialog").then((module) => ({
    default: module.FolderCreateDialog,
  })),
);
const FolderRenameDialog = lazy(() =>
  import("../folders/FolderRenameDialog").then((module) => ({
    default: module.FolderRenameDialog,
  })),
);
const SettingsDialog = lazy(() =>
  import("../settings/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);

function isInsideFolder(
  relativePath: string | undefined,
  folder: Folder,
): boolean {
  if (!relativePath || !folder.relativePath) {
    return false;
  }
  return (
    relativePath === folder.relativePath ||
    relativePath.startsWith(`${folder.relativePath}/`)
  );
}

type ReadyArchiveState = Extract<ArchiveState, { status: "ready" }>;

export function LibraryPage() {
  const archive = useArchive();

  if (archive.status !== "ready") {
    return null;
  }

  return <LibraryPageContent key={archive.archive.id} archive={archive} />;
}

function LibraryPageContent({ archive }: { archive: ReadyArchiveState }) {
  const navigate = useNavigate();
  const storage = useLibraryStorage();
  const preferences = useAppPreferences();
  const [books, setBooks] = useState<Book[] | undefined>();
  const [folders, setFolders] = useState<Folder[] | undefined>();
  const importLock = useRef(false);
  const [isImporting, setIsImporting] = useState(false);
  const [archiveImportResults, setArchiveImportResults] = useState<
    ArchiveImportResult[]
  >([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("recently-added");
  const [view, setView] = useState<LibraryView>("grid");
  const [location, setLocation] = useState<LibraryLocation>({
    type: "library",
  });
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [metadataReferenceBookId, setMetadataReferenceBookId] = useState<
    string | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [clearProgressTarget, setClearProgressTarget] = useState<Book | null>(
    null,
  );
  const [rescanConfirmationOpen, setRescanConfirmationOpen] = useState(false);
  const [isAddEpubOpen, setIsAddEpubOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [renameFolderTarget, setRenameFolderTarget] = useState<Folder | null>(
    null,
  );
  const [moveFolderTarget, setMoveFolderTarget] = useState<Folder | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<Folder | null>(
    null,
  );
  const [renameFileTarget, setRenameFileTarget] = useState<Book | null>(null);
  const [moveBookTarget, setMoveBookTarget] = useState<Book | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 150);
  const activeArchive = archive.archive;

  useEffect(() => {
    const handleStorageError = () => {
      setLibraryError("The active archive could not be loaded.");
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

  async function handleArchiveImport(input: AddArchiveEpubInput) {
    if (importLock.current) {
      return;
    }

    importLock.current = true;
    setIsImporting(true);
    setArchiveImportResults([]);
    setLibraryError(null);

    try {
      const results = await storage.addEpubFilesToArchive(input);
      setArchiveImportResults(results);
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
  const searchIndex = useMemo(
    () => createLibrarySearchIndex(books ?? [], folders),
    [books, folders],
  );
  const visibleBooks = useMemo(
    () =>
      measurePerformance("archeion:filter-and-sort-library", () =>
        getVisibleBooksFromSearchIndex(
          searchIndex,
          debouncedQuery,
          sort,
          location,
          folders,
        ),
      ),
    [debouncedQuery, folders, location, searchIndex, sort],
  );
  const selectedBook = useMemo(
    () => books?.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId],
  );
  const metadataReferenceBook = useMemo(
    () => books?.find((book) => book.id === metadataReferenceBookId) ?? null,
    [books, metadataReferenceBookId],
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
        : (currentFolder?.name ?? "Library");

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

  const openMetadataReference = useCallback((book: Book) => {
    setSelectedBookId(null);
    setMetadataReferenceBookId(book.id);
  }, []);

  const requestRenameFile = useCallback((book: Book) => {
    setSelectedBookId(null);
    setRenameFileTarget(book);
  }, []);

  const requestMoveBook = useCallback((book: Book) => {
    setSelectedBookId(null);
    setMoveBookTarget(book);
  }, []);

  function closeMetadataReference() {
    const bookId = metadataReferenceBookId;
    setMetadataReferenceBookId(null);
    setSelectedBookId(bookId);
  }

  const readBook = useCallback(
    (book: Book) => {
      void navigate(`/reader/${book.id}`);
    },
    [navigate],
  );

  const readBookFromBeginning = useCallback(
    (book: Book) => {
      void navigate(`/reader/${book.id}?start=beginning`);
    },
    [navigate],
  );

  const selectBook = useCallback((book: Book) => {
    setSelectedBookId(book.id);
  }, []);

  const openArchiveManager = useCallback(
    () => void archiveStore.openArchiveManagerWindow(),
    [],
  );
  const openAddEpub = useCallback(() => setIsAddEpubOpen(true), []);
  const openCreateFolder = useCallback(() => setIsCreateFolderOpen(true), []);
  const openAbout = useCallback(() => setAboutOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  async function rescanLibrary() {
    setLibraryError(null);

    try {
      await storage.rescan();
    } catch {
      setLibraryError("The archive could not be scanned.");
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

  async function switchArchive(archiveId: string) {
    await archiveStore.switchArchive(archiveId);
  }

  async function revealBookFile(book: Book) {
    if (!book.relativePath) return;
    setLibraryError(null);
    try {
      await storage.revealBookFile(book.id);
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

  const toggleFavorite = useCallback(
    async (book: Book) => {
      setLibraryError(null);

      try {
        await storage.updateBook(book.id, {
          isFavorite: !book.isFavorite,
        });
      } catch {
        setLibraryError("Favorite status could not be updated.");
      }
    },
    [storage],
  );

  async function renameBookFile(fileName: string) {
    if (!renameFileTarget) {
      return;
    }

    setLibraryError(null);
    await storage.renameBookFile(renameFileTarget.id, fileName);
  }

  async function moveBook(folderId: string | null) {
    if (!moveBookTarget) {
      return;
    }

    setLibraryError(null);
    await storage.moveBookToFolder(moveBookTarget.id, folderId);
  }

  async function createFolder(name: string) {
    await storage.createFolder({
      name,
      parentId: location.type === "folder" ? location.folderId : null,
    });
  }

  async function renameFolder(name: string) {
    if (!renameFolderTarget) {
      return;
    }

    await storage.updateFolder(renameFolderTarget.id, { name });
  }

  async function moveFolder(folderId: string | null) {
    if (!moveFolderTarget) {
      return;
    }

    await storage.updateFolder(moveFolderTarget.id, { parentId: folderId });
  }

  async function revealFolder(folder: Folder) {
    setLibraryError(null);
    try {
      await storage.revealFolder(folder.id);
    } catch {
      setLibraryError("The folder could not be revealed.");
    }
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
        (location.folderId === deleteFolderTarget.id ||
          isInsideFolder(currentFolder?.relativePath, deleteFolderTarget))
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
        description: "Use Add EPUB to place files in this folder.",
      };
    }

    return {
      title: "No EPUB files found",
      description: "Use Add EPUB to place files in this archive.",
    };
  }

  const emptyState = locationEmptyState();
  const archiveImportSummary =
    summarizeArchiveImportResults(archiveImportResults);
  const archiveImportDetails = archiveImportResults.filter(
    (result) => result.status !== "imported",
  );
  const archiveImportNoticeClass = archiveImportSummary
    ? [
        "import-notice",
        archiveImportSummary.failed > 0
          ? "import-notice--error"
          : "import-notice--success",
        archiveImportDetails.length > 0 ? "import-notice--detailed" : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const moveFolderExcludedIds = moveFolderTarget
    ? (folders ?? [])
        .filter(
          (folder) =>
            folder.id === moveFolderTarget.id ||
            isInsideFolder(folder.relativePath, moveFolderTarget),
        )
        .map((folder) => folder.id)
    : [];
  const deleteFolderBookCount = deleteFolderTarget
    ? (books ?? []).filter((book) =>
        isInsideFolder(book.relativePath, deleteFolderTarget),
      ).length
    : 0;

  return (
    <PageShell
      sidebar={
        <LibrarySidebar
          activeArchive={activeArchive}
          archives={archive.archives}
          bookCount={bookCount}
          favoriteCount={favoriteCount}
          continueCount={continueBooks.length}
          folders={folders ?? []}
          location={location}
          canManageFolders
          canRevealFolders
          onCreateFolder={openCreateFolder}
          onDeleteFolder={setDeleteFolderTarget}
          onManageArchives={openArchiveManager}
          onMoveFolder={setMoveFolderTarget}
          onLocationChange={changeLocation}
          onOpenAbout={openAbout}
          onOpenSettings={openSettings}
          onRenameFolder={setRenameFolderTarget}
          onRevealFolder={(folder) => void revealFolder(folder)}
          onSwitchArchive={(archive) => void switchArchive(archive.id)}
        />
      }
    >
      {location.type === "folders" ? (
        <FolderBrowser
          bookCounts={bookCountsByFolder}
          canManageFolders
          canRevealFolders
          folders={folders ?? []}
          onCreate={openCreateFolder}
          onDelete={setDeleteFolderTarget}
          onMove={setMoveFolderTarget}
          onOpen={(folder) =>
            changeLocation({ type: "folder", folderId: folder.id })
          }
          onRename={setRenameFolderTarget}
          onReveal={(folder) => void revealFolder(folder)}
        />
      ) : (
        <>
          <LibraryToolbar
            isImporting={isImporting}
            onOpenAddEpub={openAddEpub}
            onQueryChange={setQuery}
            onRescanError={() =>
              setLibraryError("The archive could not be scanned.")
            }
            onSortChange={setSort}
            onViewChange={setView}
            query={query}
            sort={sort}
            title={libraryTitle}
            view={view}
          />

          <ArchiveStatusBar />

          {libraryError ? (
            <div className="import-notice import-notice--error" role="alert">
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

          {archiveImportSummary ? (
            <div
              className={archiveImportNoticeClass}
              role={archiveImportSummary.failed > 0 ? "alert" : "status"}
            >
              {archiveImportSummary.failed > 0 ? (
                <WarningCircle aria-hidden="true" size={19} weight="regular" />
              ) : (
                <CheckCircle aria-hidden="true" size={19} weight="regular" />
              )}
              <div>
                <p>{archiveImportSummary.message}</p>
                {archiveImportDetails.length > 0 ? (
                  <ul>
                    {archiveImportDetails.map((result, index) => (
                      <li key={`${result.sourcePath}-${index}`}>
                        <span>{result.fileName}</span>
                        {result.message ??
                          (result.status === "skipped"
                            ? "Skipped."
                            : "Failed.")}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <IconButton
                label="Dismiss import summary"
                onClick={() => setArchiveImportResults([])}
              >
                <X aria-hidden="true" size={17} weight="regular" />
              </IconButton>
            </div>
          ) : null}

          <div className="library-content">
            {location.type === "library" &&
            !query &&
            preferences.showContinueReading ? (
              <ContinueReading books={continuePreview} onContinue={readBook} />
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
                canManageFile
                onDelete={requestDelete}
                onMove={requestMoveBook}
                onRead={readBook}
                onRenameFile={requestRenameFile}
                onRevealFile={(book) => void revealBookFile(book)}
                onSelect={selectBook}
                onToggleFavorite={toggleFavorite}
              />
            ) : (
              <BookList
                books={visibleBooks}
                canManageFile
                onDelete={requestDelete}
                onMove={requestMoveBook}
                onRead={readBook}
                onRenameFile={requestRenameFile}
                onRevealFile={(book) => void revealBookFile(book)}
                onSelect={selectBook}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </div>
        </>
      )}

      {isAddEpubOpen ? (
        <Suspense fallback={null}>
          <AddEpubDialog
            folders={folders ?? []}
            initialFolderPath={currentFolder?.relativePath}
            isImporting={isImporting}
            onClose={() => setIsAddEpubOpen(false)}
            onImport={handleArchiveImport}
          />
        </Suspense>
      ) : null}

      {selectedBook ? (
        <Suspense fallback={null}>
          <BookDetailsDrawer
            book={selectedBook}
            canManageFile
            canRevealFile
            onClose={closeDetails}
            onClearProgress={requestClearProgress}
            onDelete={requestDelete}
            onViewMetadata={openMetadataReference}
            onMoveFile={requestMoveBook}
            onRead={readBook}
            onReadFromBeginning={readBookFromBeginning}
            onRenameFile={requestRenameFile}
            onRevealFile={(book) => void revealBookFile(book)}
            onRescan={() => {
              setSelectedBookId(null);
              setRescanConfirmationOpen(true);
            }}
            onToggleFavorite={toggleFavorite}
          />
        </Suspense>
      ) : null}

      {metadataReferenceBook ? (
        <Suspense fallback={null}>
          <BookMetadataReferenceDialog
            book={metadataReferenceBook}
            onClose={closeMetadataReference}
          />
        </Suspense>
      ) : null}

      {renameFileTarget ? (
        <Suspense fallback={null}>
          <RenameFileDialog
            book={renameFileTarget}
            onClose={() => setRenameFileTarget(null)}
            onRename={renameBookFile}
          />
        </Suspense>
      ) : null}

      {moveBookTarget ? (
        <Suspense fallback={null}>
          <MoveToFolderDialog
            currentFolderId={moveBookTarget.folderId ?? null}
            folders={folders ?? []}
            onClose={() => setMoveBookTarget(null)}
            onMove={moveBook}
            title="Move EPUB file"
          />
        </Suspense>
      ) : null}

      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => setSettingsOpen(false)} />
        </Suspense>
      ) : null}
      {aboutOpen ? (
        <Suspense fallback={null}>
          <AboutDialog onClose={() => setAboutOpen(false)} />
        </Suspense>
      ) : null}

      {isCreateFolderOpen ? (
        <Suspense fallback={null}>
          <FolderCreateDialog
            onClose={() => setIsCreateFolderOpen(false)}
            onCreate={createFolder}
          />
        </Suspense>
      ) : null}

      {renameFolderTarget ? (
        <Suspense fallback={null}>
          <FolderRenameDialog
            folder={renameFolderTarget}
            onClose={() => setRenameFolderTarget(null)}
            onRename={renameFolder}
          />
        </Suspense>
      ) : null}

      {moveFolderTarget ? (
        <Suspense fallback={null}>
          <MoveToFolderDialog
            currentFolderId={moveFolderTarget.parentId ?? null}
            excludedFolderIds={moveFolderExcludedIds}
            folders={folders ?? []}
            onClose={() => setMoveFolderTarget(null)}
            onMove={moveFolder}
            title="Move folder"
          />
        </Suspense>
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
              ? `Favorites and progress for “${bookTitle(deleteTarget)}” will be removed. No EPUB file will be deleted.`
              : `The EPUB file for “${bookTitle(deleteTarget)}” will be moved to Trash when available. Reading data will be removed.`
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
          description={`The saved reading position for “${bookTitle(clearProgressTarget)}” will be removed. The EPUB file is not changed.`}
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

      {rescanConfirmationOpen ? (
        <Dialog
          title="Rescan archive?"
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
                Rescan archive
              </Button>
            </>
          }
        />
      ) : null}

      {deleteFolderTarget ? (
        <Dialog
          title="Delete this folder?"
          description={`The “${deleteFolderTarget.name}” folder and ${deleteFolderBookCount} contained EPUB ${
            deleteFolderBookCount === 1 ? "file" : "files"
          } will be moved to Trash when available.`}
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
