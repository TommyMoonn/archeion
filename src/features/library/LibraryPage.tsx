import { BookOpenText } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { DialogLoadingFallback } from "../../components/DialogLoadingFallback";
import { EmptyState } from "../../components/EmptyState";
import { PageShell } from "../../components/PageShell";
import type { AddArchiveEpubInput, ScanStatus } from "../../storage/LibraryStorage";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferences,
  useImportPreferences,
  useLibraryPreferences,
  useShowContinueReadingPreference,
} from "../../stores/appPreferencesStore";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import type { Book, EpubMetadataWritebackInput } from "../../types/book";
import type { Folder } from "../../types/folder";
import { createDefaultLibraryFilters, type LibraryFilterState } from "../../types/library";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import type { ArchiveImportSettings, ImportSettings } from "../../types/settings";
import { scrollElementToTop } from "../../utils/motion";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { FolderBrowser } from "../folders/FolderBrowser";
import { useArchive } from "../archive/useArchive";
import {
  countSeriesGroups,
  createSeriesEntriesCache,
  getCachedSeriesEntries,
} from "../series/seriesDerivation";
import {
  shouldConfirmBookDeletion,
  shouldConfirmFolderDeletion,
} from "../filesystem/destructiveActionPolicy";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import { ContinueReading } from "./ContinueReading";
import {
  bookTitle,
  createLibrarySearchIndexCache,
  hasActiveLibraryFilters,
  pruneUnavailableLibraryMetadataFilters,
  type LibraryLocation,
  type LibrarySort,
} from "./libraryFilters";
import { useLibraryDerivedState } from "./libraryDerivedState";
import { LibraryFeedbackStack } from "./LibraryFeedbackStack";
import {
  createDeleteErrorFeedbackToken,
  createDeleteSuccessFeedbackToken,
  createFolderSuccessFeedbackToken,
  createImportFeedbackToken,
  type LibraryFeedbackDraft,
  type LibraryFeedbackToken,
  upsertLibraryFeedbackToken,
} from "./libraryFeedback";
import { LibrarySidebar } from "./LibrarySidebar";
import { LibraryToolbar, type LibraryView } from "./LibraryToolbar";
import {
  folderBrowserViewFromSearchParams,
  libraryLocationFromSearchParams,
  searchParamsForFolderBrowserView,
  searchParamsForLibraryLocation,
  type FolderBrowserView,
} from "./libraryViewState";

const loadAddEpubDialog = () =>
  import("../filesystem/AddEpubDialog").then((module) => ({
    default: module.AddEpubDialog,
  }));
const loadMoveToFolderDialog = () =>
  import("../filesystem/MoveToFolderDialog").then((module) => ({
    default: module.MoveToFolderDialog,
  }));
const loadRenameFileDialog = () =>
  import("../filesystem/RenameFileDialog").then((module) => ({
    default: module.RenameFileDialog,
  }));
const loadAboutDialog = () =>
  import("../settings/AboutDialog").then((module) => ({
    default: module.AboutDialog,
  }));
const loadBookDetailsDrawer = () =>
  import("./BookDetailsDrawer").then((module) => ({
    default: module.BookDetailsDrawer,
  }));
const loadBookAdvancedMetadataDialog = () =>
  import("./BookAdvancedMetadataDialog").then((module) => ({
    default: module.BookAdvancedMetadataDialog,
  }));
const loadFolderCreateDialog = () =>
  import("../folders/FolderCreateDialog").then((module) => ({
    default: module.FolderCreateDialog,
  }));
const loadFolderRenameDialog = () =>
  import("../folders/FolderRenameDialog").then((module) => ({
    default: module.FolderRenameDialog,
  }));
const loadSettingsDialog = () =>
  import("../settings/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  }));
const loadReaderPage = () => import("../reader/ReaderPage");
const loadSeriesDetail = () =>
  import("../series/SeriesDetail").then((module) => ({ default: module.SeriesDetail }));
const loadSeriesOverview = () =>
  import("../series/SeriesOverview").then((module) => ({ default: module.SeriesOverview }));

const AddEpubDialog = lazy(loadAddEpubDialog);
const MoveToFolderDialog = lazy(loadMoveToFolderDialog);
const RenameFileDialog = lazy(loadRenameFileDialog);
const AboutDialog = lazy(loadAboutDialog);
const BookDetailsDrawer = lazy(loadBookDetailsDrawer);
const BookAdvancedMetadataDialog = lazy(loadBookAdvancedMetadataDialog);
const FolderCreateDialog = lazy(loadFolderCreateDialog);
const FolderRenameDialog = lazy(loadFolderRenameDialog);
const SettingsDialog = lazy(loadSettingsDialog);
const SeriesDetail = lazy(loadSeriesDetail);
const SeriesOverview = lazy(loadSeriesOverview);

function preloadAboutDialog() {
  void loadAboutDialog();
}

function preloadBookAdvancedMetadataDialog() {
  void loadBookAdvancedMetadataDialog();
}

function preloadBookDetailsDrawer() {
  void loadBookDetailsDrawer();
}

function preloadReaderPage() {
  void loadReaderPage();
}

function preloadSettingsDialog() {
  void loadSettingsDialog();
}

function getLocationKey(location: LibraryLocation): string {
  if (location.type === "folder") return `folder:${location.folderId}`;
  if (location.type === "series-detail") return `series:${location.seriesKey}`;
  if (location.type === "smart-view") return `smart:${location.smartView}`;
  return location.type;
}

function getLibrarySurfaceState(
  books: Book[] | undefined,
  debouncedQuery: string,
  hasFilters: boolean,
  isImporting: boolean,
  visibleBooks: Book[],
): "empty" | "filter-empty" | "loading" | "results" | "search-empty" {
  if (books === undefined || (isImporting && books.length === 0)) {
    return "loading";
  }

  if (visibleBooks.length > 0) {
    return "results";
  }

  if (debouncedQuery) return "search-empty";
  return hasFilters ? "filter-empty" : "empty";
}

function isInsideFolder(relativePath: string | undefined, folder: Folder): boolean {
  if (!relativePath || !folder.relativePath) {
    return false;
  }
  return relativePath === folder.relativePath || relativePath.startsWith(`${folder.relativePath}/`);
}

type ReadyArchiveState = Extract<ArchiveState, { status: "ready" }>;

type ArchiveBooksLoadState =
  | { status: "loading"; archiveId: string; books: Book[] | undefined }
  | { status: "ready"; archiveId: string; books: Book[] }
  | { status: "error"; archiveId: string; books: Book[] | undefined };

export function LibraryPage() {
  const archive = useArchive();

  if (archive.status !== "ready") {
    return null;
  }

  return <LibraryPageContent key={archive.archive.id} archive={archive} />;
}

function LibraryPageContent({ archive }: { archive: ReadyArchiveState }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const storage = useLibraryStorage();
  const libraryPreferences = useLibraryPreferences();
  const globalImportPreferences = useImportPreferences();
  const { confirmDestructiveFileActions } = useAppPreferences();
  const showContinueReading = useShowContinueReadingPreference();
  const [booksLoadState, setBooksLoadState] = useState<ArchiveBooksLoadState>({
    status: "loading",
    archiveId: archive.archive.id,
    books: undefined,
  });
  const [folders, setFolders] = useState<Folder[] | undefined>();
  const pageShellRef = useRef<HTMLElement>(null);
  const importLock = useRef(false);
  const deleteLock = useRef(false);
  const feedbackSequenceRef = useRef(0);
  const [isImporting, setIsImporting] = useState(false);
  const [feedbackTokens, setFeedbackTokens] = useState<LibraryFeedbackToken[]>([]);
  const [query, setQuery] = useState("");
  const [seriesQuery, setSeriesQuery] = useState("");
  const [archiveImportSettings, setArchiveImportSettings] = useState<ArchiveImportSettings>(
    defaultArchiveImportSettings,
  );
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [metadataEditorBookId, setMetadataEditorBookId] = useState<string | null>(null);
  const [clearProgressTarget, setClearProgressTarget] = useState<Book | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [rescanConfirmationOpen, setRescanConfirmationOpen] = useState(false);
  const [isAddEpubOpen, setIsAddEpubOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [renameFolderTarget, setRenameFolderTarget] = useState<Folder | null>(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState<Folder | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<Folder | null>(null);
  const [renameFileTarget, setRenameFileTarget] = useState<Book | null>(null);
  const [moveBookTarget, setMoveBookTarget] = useState<Book | null>(null);
  const [isClearingProgress, setIsClearingProgress] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 150);
  const [searchIndexCache] = useState(() => createLibrarySearchIndexCache());
  const [seriesEntriesCache] = useState(() => createSeriesEntriesCache());
  const activeArchive = archive.archive;
  const books = booksLoadState.books;
  const filters = libraryPreferences.filters;
  const sort = libraryPreferences.sortBy;
  const view = libraryPreferences.viewMode;
  const hasFilters = hasActiveLibraryFilters(filters);
  const importSettings: ImportSettings = {
    ...globalImportPreferences,
    ...archiveImportSettings,
  };

  const dismissFeedback = useCallback((id: string) => {
    setFeedbackTokens((currentTokens) => currentTokens.filter((token) => token.id !== id));
  }, []);

  const pushFeedback = useCallback((feedback: LibraryFeedbackDraft) => {
    const id = feedback.id ?? `library-feedback-${feedbackSequenceRef.current++}`;
    setFeedbackTokens((currentTokens) =>
      upsertLibraryFeedbackToken(currentTokens, { ...feedback, id }),
    );
    return id;
  }, []);

  const showLibraryError = useCallback(
    (title: string, detail?: string) => {
      pushFeedback({ id: "library-error", tone: "error", title, detail });
    },
    [pushFeedback],
  );

  const showRescanSuccess = useCallback(() => {
    pushFeedback({
      id: "manual-rescan",
      tone: "success",
      title: "Archive refreshed.",
      autoDismiss: true,
    });
  }, [pushFeedback]);

  const showRescanError = useCallback(() => {
    pushFeedback({
      id: "manual-rescan",
      tone: "error",
      title: "The archive could not be scanned.",
    });
  }, [pushFeedback]);
  const location = useMemo(
    () => libraryLocationFromSearchParams(searchParams, folders ?? [], activeArchive.id),
    [activeArchive.id, folders, searchParams],
  );
  const seriesCount = useMemo(() => countSeriesGroups(books ?? []), [books]);
  const needsSeriesEntries = location.type === "series" || location.type === "series-detail";
  const seriesEntries = useMemo(
    () =>
      needsSeriesEntries
        ? getCachedSeriesEntries(books ?? [], seriesEntriesCache)
        : seriesEntriesCache.entries,
    [books, needsSeriesEntries, seriesEntriesCache],
  );
  const activeSeries =
    location.type === "series-detail"
      ? seriesEntries.find((entry) => entry.key === location.seriesKey)
      : undefined;
  const folderBrowserView = useMemo(
    () => folderBrowserViewFromSearchParams(searchParams),
    [searchParams],
  );

  useEffect(() => {
    const preloadPrimarySurfaces = () => {
      preloadReaderPage();
      preloadBookDetailsDrawer();
      preloadBookAdvancedMetadataDialog();
      preloadSettingsDialog();
      preloadAboutDialog();
    };
    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    };

    if (
      typeof idleWindow.requestIdleCallback === "function" &&
      typeof idleWindow.cancelIdleCallback === "function"
    ) {
      const idleId = idleWindow.requestIdleCallback(preloadPrimarySurfaces, {
        timeout: 2500,
      });

      return () => idleWindow.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(preloadPrimarySurfaces, 1200);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    let active = true;
    let currentScanStatus: ScanStatus["status"] = "idle";
    let pendingBooks: Book[] | undefined;
    let booksLoadFailed = false;
    const archiveId = activeArchive.id;

    const handleStorageError = () => {
      showLibraryError("The active archive could not be loaded.");
    };
    const publishReadyBooks = () => {
      if (
        !active ||
        currentScanStatus !== "idle" ||
        booksLoadFailed ||
        pendingBooks === undefined
      ) {
        return;
      }

      setBooksLoadState({ status: "ready", archiveId, books: pendingBooks });
    };
    const stopScanStatus = storage.observeScanStatus({
      next: (status) => {
        if (!active) return;

        currentScanStatus = status.status;
        if (status.status === "scanning") {
          booksLoadFailed = false;
          setBooksLoadState((currentState) => ({
            status: "loading",
            archiveId,
            books: currentState.archiveId === archiveId ? currentState.books : undefined,
          }));
          return;
        }

        publishReadyBooks();
      },
      error: () => {
        if (!active) return;
        booksLoadFailed = true;
        setBooksLoadState((currentState) => ({
          status: "error",
          archiveId,
          books: currentState.archiveId === archiveId ? currentState.books : undefined,
        }));
        handleStorageError();
      },
    });
    const stopBooks = storage.observeBooks({
      next: (nextBooks) => {
        if (!active) return;

        pendingBooks = nextBooks;
        booksLoadFailed = false;
        if (currentScanStatus === "idle") {
          setBooksLoadState({ status: "ready", archiveId, books: nextBooks });
        } else {
          setBooksLoadState({ status: "loading", archiveId, books: nextBooks });
        }
      },
      error: () => {
        if (!active) return;
        booksLoadFailed = true;
        setBooksLoadState((currentState) => ({
          status: "error",
          archiveId,
          books: currentState.archiveId === archiveId ? currentState.books : pendingBooks,
        }));
        handleStorageError();
      },
    });
    const stopFolders = storage.observeFolders({
      next: setFolders,
      error: handleStorageError,
    });

    return () => {
      active = false;
      stopScanStatus();
      stopBooks();
      stopFolders();
    };
  }, [activeArchive.id, showLibraryError, storage]);

  useEffect(() => {
    if (archive.watcherError) {
      pushFeedback({
        id: "watcher-error",
        tone: "error",
        title: archive.watcherError,
      });
    }
  }, [archive.watcherError, pushFeedback]);

  useEffect(() => {
    let cancelled = false;

    void storage
      .getArchiveImportSettings()
      .then((loadedImportSettings) => {
        if (!cancelled) setArchiveImportSettings(loadedImportSettings);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [storage]);

  const changeSort = useCallback(
    (nextSort: LibrarySort) => {
      void appPreferencesStore
        .update({
          library: { ...libraryPreferences, sortBy: nextSort },
        })
        .catch(() => showLibraryError("Library preferences could not be saved."));
    },
    [libraryPreferences, showLibraryError],
  );

  const changeView = useCallback(
    (nextView: LibraryView) => {
      void appPreferencesStore
        .update({
          library: { ...libraryPreferences, viewMode: nextView },
        })
        .catch(() => showLibraryError("Library preferences could not be saved."));
    },
    [libraryPreferences, showLibraryError],
  );

  const changeFilters = useCallback(
    (nextFilters: LibraryFilterState) => {
      void appPreferencesStore
        .update({
          library: { ...libraryPreferences, filters: nextFilters },
        })
        .catch(() => showLibraryError("Library filters could not be saved."));
    },
    [libraryPreferences, showLibraryError],
  );

  async function handleArchiveImport(input: AddArchiveEpubInput) {
    if (importLock.current) {
      return;
    }

    importLock.current = true;
    setIsImporting(true);
    dismissFeedback("library-error");
    dismissFeedback("archive-import");

    try {
      const results = await storage.addEpubFilesToArchive(input);
      const feedback = createImportFeedbackToken("archive-import", results);
      if (feedback) {
        pushFeedback(feedback);
      }
    } catch (error) {
      pushFeedback({
        id: "archive-import",
        tone: "error",
        title: "The EPUB files could not be added.",
      });
      throw error;
    } finally {
      importLock.current = false;
      setIsImporting(false);
    }
  }

  const {
    bookCount,
    bookCountsByFolder,
    continuePreview,
    currentFolder,
    effectiveSort,
    favoriteCount,
    filterOptions,
    libraryTitle,
    metadataEditorBook,
    selectedBook,
    smartViewCounts,
    visibleBooks,
  } = useLibraryDerivedState({
    books,
    debouncedQuery,
    filters,
    folders,
    location,
    metadataEditorBookId,
    searchIndexCache,
    selectedBookId,
    sort,
  });

  useEffect(() => {
    if (booksLoadState.status !== "ready" || booksLoadState.archiveId !== activeArchive.id) {
      return;
    }

    const nextFilters = pruneUnavailableLibraryMetadataFilters(filters, filterOptions);
    if (nextFilters !== filters) {
      changeFilters(nextFilters);
    }
  }, [activeArchive.id, booksLoadState, changeFilters, filterOptions, filters]);

  const closeDetails = useCallback(() => setSelectedBookId(null), []);
  const scrollMainContentToTop = useCallback(() => {
    scrollElementToTop(pageShellRef.current);
  }, []);
  const clearFilters = useCallback(() => {
    changeFilters(createDefaultLibraryFilters());
    scrollMainContentToTop();
  }, [changeFilters, scrollMainContentToTop]);

  const changeLocation = useCallback(
    (nextLocation: LibraryLocation) => {
      if (getLocationKey(location) !== getLocationKey(nextLocation)) {
        scrollMainContentToTop();
      }

      const nextParams = searchParamsForLibraryLocation(
        searchParams,
        nextLocation,
        folders ?? [],
        activeArchive.id,
      );

      if (nextParams.toString() !== searchParams.toString()) {
        setSearchParams(nextParams);
      }
    },
    [activeArchive.id, folders, location, scrollMainContentToTop, searchParams, setSearchParams],
  );

  const changeFolderBrowserView = useCallback(
    (nextView: FolderBrowserView) => {
      const nextParams = searchParamsForFolderBrowserView(searchParams, nextView);

      if (nextParams.toString() !== searchParams.toString()) {
        setSearchParams(nextParams, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const clearLibrarySearch = useCallback(() => {
    setQuery("");
    scrollMainContentToTop();
  }, [scrollMainContentToTop]);

  const deleteBook = useCallback(
    async (book: Book) => {
      if (deleteLock.current) {
        return;
      }

      deleteLock.current = true;
      setIsDeleting(true);
      dismissFeedback("library-error");

      try {
        await storage.deleteBook(book.id);
        pushFeedback(
          createDeleteSuccessFeedbackToken(book.isFileMissing ? "metadataRemoved" : "bookDeleted"),
        );
      } catch {
        pushFeedback(
          createDeleteErrorFeedbackToken(
            book.isFileMissing ? "metadataRemoveFailed" : "bookDeleteFailed",
          ),
        );
      } finally {
        setDeleteTarget(null);
        deleteLock.current = false;
        setIsDeleting(false);
      }
    },
    [dismissFeedback, pushFeedback, storage],
  );

  const requestDelete = useCallback(
    (book: Book) => {
      setSelectedBookId(null);
      if (shouldConfirmBookDeletion(confirmDestructiveFileActions, Boolean(book.isFileMissing))) {
        setDeleteTarget(book);
      } else {
        void deleteBook(book);
      }
    },
    [confirmDestructiveFileActions, deleteBook],
  );

  const requestClearProgress = useCallback((book: Book) => {
    setSelectedBookId(null);
    setClearProgressTarget(book);
  }, []);

  const deleteFolder = useCallback(
    async (folder: Folder) => {
      if (deleteLock.current) {
        return;
      }

      deleteLock.current = true;
      setIsDeleting(true);
      dismissFeedback("library-error");

      try {
        await storage.deleteFolder(folder.id);

        if (
          location.type === "folder" &&
          (location.folderId === folder.id || isInsideFolder(currentFolder?.relativePath, folder))
        ) {
          changeLocation({ type: "library" });
        }

        pushFeedback(createDeleteSuccessFeedbackToken("folderDeleted"));
      } catch {
        pushFeedback(createDeleteErrorFeedbackToken("folderDeleteFailed"));
      } finally {
        setDeleteFolderTarget(null);
        deleteLock.current = false;
        setIsDeleting(false);
      }
    },
    [changeLocation, currentFolder, dismissFeedback, location, pushFeedback, storage],
  );

  const requestDeleteFolder = useCallback(
    (folder: Folder) => {
      if (shouldConfirmFolderDeletion(confirmDestructiveFileActions)) {
        setDeleteFolderTarget(folder);
      } else {
        void deleteFolder(folder);
      }
    },
    [confirmDestructiveFileActions, deleteFolder],
  );

  const openMetadataEditor = useCallback((book: Book) => {
    setSelectedBookId(null);
    setMetadataEditorBookId(book.id);
  }, []);

  const requestRenameFile = useCallback((book: Book) => {
    setSelectedBookId(null);
    setRenameFileTarget(book);
  }, []);

  const requestMoveBook = useCallback((book: Book) => {
    setSelectedBookId(null);
    setMoveBookTarget(book);
  }, []);

  function closeMetadataEditor() {
    const bookId = metadataEditorBookId;
    setMetadataEditorBookId(null);
    setSelectedBookId(bookId);
  }

  const writeBookMetadata = useCallback(
    async (book: Book, metadata: EpubMetadataWritebackInput) => {
      const result = await storage.writeBookMetadata(book.id, metadata);
      return result;
    },
    [storage],
  );

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

  const openArchiveManager = useCallback(() => void archiveStore.openArchiveManagerWindow(), []);
  const openAddEpub = useCallback(() => setIsAddEpubOpen(true), []);
  const openCreateFolder = useCallback(() => setIsCreateFolderOpen(true), []);
  const openAbout = useCallback(() => setAboutOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  async function rescanLibrary() {
    dismissFeedback("library-error");

    try {
      await storage.rescan();
      showRescanSuccess();
    } catch {
      showRescanError();
    }
  }

  async function switchArchive(archiveId: string) {
    setSearchParams(
      searchParamsForLibraryLocation(searchParams, { type: "library" }, folders ?? [], archiveId),
      { replace: true },
    );
    await archiveStore.switchArchive(archiveId);
  }

  const revealBookFile = useCallback(
    async (book: Book) => {
      if (!book.relativePath) return;
      dismissFeedback("library-error");
      try {
        await storage.revealBookFile(book.id);
      } catch {
        showLibraryError("The EPUB could not be revealed in its folder.");
      }
    },
    [dismissFeedback, showLibraryError, storage],
  );

  async function confirmDelete() {
    if (!deleteTarget || isDeleting) {
      return;
    }

    await deleteBook(deleteTarget);
  }

  async function confirmClearProgress() {
    if (!clearProgressTarget || isClearingProgress) {
      return;
    }

    const targetId = clearProgressTarget.id;
    setIsClearingProgress(true);
    dismissFeedback("clear-progress");

    try {
      const updated = await storage.updateBook(targetId, {
        progressCfi: undefined,
        progressPercent: 0,
      });

      if (!updated) {
        throw new Error("The active archive changed before progress was cleared.");
      }

      pushFeedback({
        id: "clear-progress",
        tone: "success",
        title: "Reading progress cleared.",
        autoDismiss: true,
      });
    } catch {
      pushFeedback({
        id: "clear-progress",
        tone: "error",
        title: "Reading progress could not be cleared.",
      });
    } finally {
      setClearProgressTarget(null);
      setSelectedBookId(targetId);
      setIsClearingProgress(false);
    }
  }

  const toggleFavorite = useCallback(
    async (book: Book) => {
      dismissFeedback("library-error");

      try {
        await storage.updateBook(book.id, {
          isFavorite: !book.isFavorite,
        });
      } catch {
        showLibraryError("Favorite status could not be updated.");
      }
    },
    [dismissFeedback, showLibraryError, storage],
  );

  async function renameBookFile(fileName: string) {
    if (!renameFileTarget) {
      return;
    }

    dismissFeedback("library-error");
    await storage.renameBookFile(renameFileTarget.id, fileName);
  }

  async function moveBook(folderId: string | null) {
    if (!moveBookTarget) {
      return;
    }

    dismissFeedback("library-error");
    await storage.moveBookToFolder(moveBookTarget.id, folderId);
  }

  async function createFolder(name: string) {
    await storage.createFolder({
      name,
      parentId: location.type === "folder" ? location.folderId : null,
    });
    pushFeedback(createFolderSuccessFeedbackToken());
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
    dismissFeedback("library-error");
    try {
      await storage.revealFolder(folder.id);
    } catch {
      showLibraryError("The folder could not be revealed.");
    }
  }

  async function confirmDeleteFolder() {
    if (!deleteFolderTarget || isDeleting) {
      return;
    }

    await deleteFolder(deleteFolderTarget);
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

    if (location.type === "smart-view") {
      return {
        title: `No books in ${libraryTitle.toLocaleLowerCase()}`,
        description: "Books matching this smart view will appear here.",
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
    ? (books ?? []).filter((book) => isInsideFolder(book.relativePath, deleteFolderTarget)).length
    : 0;
  const librarySurfaceState = getLibrarySurfaceState(
    books,
    debouncedQuery,
    hasFilters,
    isImporting,
    visibleBooks,
  );
  const librarySurfaceKey = `${getLocationKey(location)}:${view}:${librarySurfaceState}`;

  return (
    <PageShell
      mainRef={pageShellRef}
      sidebar={
        <LibrarySidebar
          activeArchive={activeArchive}
          archives={archive.archives}
          bookCount={bookCount}
          favoriteCount={favoriteCount}
          folders={folders ?? []}
          location={location}
          seriesCount={seriesCount}
          smartViewCounts={smartViewCounts}
          canManageFolders
          canRevealFolders
          onCreateFolder={openCreateFolder}
          onDeleteFolder={requestDeleteFolder}
          onManageArchives={openArchiveManager}
          onMoveFolder={setMoveFolderTarget}
          onLocationChange={changeLocation}
          onOpenAbout={openAbout}
          onOpenSettings={openSettings}
          onPreloadAbout={preloadAboutDialog}
          onPreloadSettings={preloadSettingsDialog}
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
          onDelete={requestDeleteFolder}
          onMove={setMoveFolderTarget}
          onOpen={(folder) => changeLocation({ type: "folder", folderId: folder.id })}
          onRename={setRenameFolderTarget}
          onReveal={(folder) => void revealFolder(folder)}
          onViewChange={changeFolderBrowserView}
          view={folderBrowserView}
        />
      ) : location.type === "series" ? (
        <Suspense
          fallback={
            <div className="library-loading" role="status">
              Loading series
            </div>
          }
        >
          <SeriesOverview
            entries={seriesEntries}
            isLoading={books === undefined}
            onClearSearch={() => setSeriesQuery("")}
            onOpen={(entry) => changeLocation({ type: "series-detail", seriesKey: entry.key })}
            onQueryChange={setSeriesQuery}
            onRead={readBook}
            query={seriesQuery}
          />
        </Suspense>
      ) : location.type === "series-detail" ? (
        <Suspense
          fallback={
            <div className="library-loading" role="status">
              Loading series
            </div>
          }
        >
          <SeriesDetail
            entry={activeSeries}
            onBack={() => changeLocation({ type: "series" })}
            onRead={readBook}
          />
        </Suspense>
      ) : (
        <>
          <LibraryToolbar
            filters={filters}
            filterOptions={filterOptions}
            isImporting={isImporting}
            onClearFilters={clearFilters}
            onOpenAddEpub={openAddEpub}
            onClearSearch={clearLibrarySearch}
            onFilterChange={changeFilters}
            onQueryChange={setQuery}
            onRescanError={showRescanError}
            onRescanSuccess={showRescanSuccess}
            onSortChange={changeSort}
            onViewChange={changeView}
            query={query}
            resultCount={visibleBooks.length}
            sort={effectiveSort}
            title={libraryTitle}
            view={view}
          />

          <div
            className="library-content"
            data-surface-state={librarySurfaceState}
            key={librarySurfaceKey}
          >
            {location.type === "library" && !query && !hasFilters && showContinueReading ? (
              <ContinueReading books={continuePreview} onContinue={readBook} />
            ) : null}
            {books === undefined || (isImporting && books.length === 0) ? (
              <div className="library-loading" role="status">
                <span className="library-loading__cover" />
                <span>{isImporting ? "Adding EPUB files" : "Loading library"}</span>
              </div>
            ) : visibleBooks.length === 0 && hasFilters && !debouncedQuery ? (
              <EmptyState
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
                description="Remove one or more filters to broaden this view."
                icon={<BookOpenText size={42} weight="thin" />}
                title="No matching books"
              />
            ) : visibleBooks.length === 0 && !debouncedQuery ? (
              <EmptyState
                description={emptyState.description}
                icon={<BookOpenText size={42} weight="thin" />}
                title={emptyState.title}
              />
            ) : visibleBooks.length === 0 ? (
              <EmptyState
                action={
                  <Button variant="secondary" onClick={clearLibrarySearch}>
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
                onRevealFile={revealBookFile}
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
                onRevealFile={revealBookFile}
                onSelect={selectBook}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </div>
        </>
      )}

      <LibraryFeedbackStack onDismiss={dismissFeedback} tokens={feedbackTokens} />

      {isAddEpubOpen ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening import dialog" />}>
          <AddEpubDialog
            confirmDestructiveFileActions={confirmDestructiveFileActions}
            folders={folders ?? []}
            importDefaults={importSettings}
            initialFolderPath={currentFolder?.relativePath}
            isImporting={isImporting}
            onClose={() => setIsAddEpubOpen(false)}
            onImport={handleArchiveImport}
          />
        </Suspense>
      ) : null}

      {selectedBook ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening book details" />}>
          <BookDetailsDrawer
            book={selectedBook}
            canManageFile
            canRevealFile
            onClearProgress={requestClearProgress}
            onClose={closeDetails}
            onDelete={requestDelete}
            onViewMetadata={openMetadataEditor}
            onMoveFile={requestMoveBook}
            onRead={readBook}
            onReadFromBeginning={readBookFromBeginning}
            onRenameFile={requestRenameFile}
            onRevealFile={revealBookFile}
            onRescan={() => {
              setSelectedBookId(null);
              setRescanConfirmationOpen(true);
            }}
            onToggleFavorite={toggleFavorite}
          />
        </Suspense>
      ) : null}

      {metadataEditorBook ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening metadata editor" />}>
          <BookAdvancedMetadataDialog
            book={metadataEditorBook}
            onClose={closeMetadataEditor}
            onWriteMetadata={writeBookMetadata}
          />
        </Suspense>
      ) : null}

      {renameFileTarget ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening rename dialog" />}>
          <RenameFileDialog
            book={renameFileTarget}
            onClose={() => setRenameFileTarget(null)}
            onRename={renameBookFile}
          />
        </Suspense>
      ) : null}

      {moveBookTarget ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening move dialog" />}>
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
        <Suspense fallback={<DialogLoadingFallback label="Opening settings" />}>
          <SettingsDialog onClose={() => setSettingsOpen(false)} />
        </Suspense>
      ) : null}
      {aboutOpen ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening About" />}>
          <AboutDialog onClose={() => setAboutOpen(false)} />
        </Suspense>
      ) : null}

      {isCreateFolderOpen ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening folder dialog" />}>
          <FolderCreateDialog
            onClose={() => setIsCreateFolderOpen(false)}
            onCreate={createFolder}
          />
        </Suspense>
      ) : null}

      {renameFolderTarget ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening folder dialog" />}>
          <FolderRenameDialog
            folder={renameFolderTarget}
            onClose={() => setRenameFolderTarget(null)}
            onRename={renameFolder}
          />
        </Suspense>
      ) : null}

      {moveFolderTarget ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening move dialog" />}>
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
          title={deleteTarget.isFileMissing ? "Remove book metadata?" : "Delete EPUB file?"}
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
              <Button variant="danger" disabled={isDeleting} onClick={confirmDelete}>
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
          description={`This resets the saved reading position for “${bookTitle(clearProgressTarget)}”. The EPUB file and last-opened date are not changed.`}
          onClose={() => {
            if (!isClearingProgress) {
              setSelectedBookId(clearProgressTarget.id);
              setClearProgressTarget(null);
            }
          }}
          footer={
            <>
              <Button
                disabled={isClearingProgress}
                onClick={() => {
                  setSelectedBookId(clearProgressTarget.id);
                  setClearProgressTarget(null);
                }}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button autoFocus disabled={isClearingProgress} onClick={confirmClearProgress}>
                {isClearingProgress ? "Clearing" : "Clear progress"}
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
              <Button onClick={() => setRescanConfirmationOpen(false)} variant="secondary">
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
              <Button variant="danger" disabled={isDeleting} onClick={confirmDeleteFolder}>
                {isDeleting ? "Deleting" : "Delete folder"}
              </Button>
            </>
          }
        />
      ) : null}
    </PageShell>
  );
}
