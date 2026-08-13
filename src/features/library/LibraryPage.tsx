import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ArchiveState } from "../../stores/archiveStore";
import { archiveStore } from "../../stores/archiveStore";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import type { LibrarySnapshotBook, LibrarySnapshotFolder } from "../../storage/LibraryStorage";
import {
  useBooksCollectionPreferences,
  useConfirmDestructiveFileActionsPreference,
  useFoldersCollectionPreferences,
  useImportPreferences,
  useLibraryPreferences,
  useSeriesCollectionPreferences,
  useShowContinueReadingPreference,
  appPreferencesStore,
} from "../../stores/appPreferencesStore";
import type { LibraryLocation } from "../../types/library";
import {
  createDefaultLibraryFilters,
  isLibraryIntegrityLocation,
  libraryIntegrityLocationLabel,
} from "../../types/library";
import { isLibrarySmartViewVisible } from "../../types/librarySmartViews";
import type { SeriesEntry } from "../../types/series";
import type { ImportSettings } from "../../types/settings";
import { currentFocusOrigin, focusElementIfRestorationOwned } from "../../utils/focusRestoration";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { useArchive } from "../archive/useArchive";
import {
  ARCHIVE_ROOT_DESTINATION,
  destinationValueToFolderPath,
} from "../filesystem/archiveImport";
import { useExternalEpubDrop } from "../filesystem/useExternalEpubDrop";
import type { AppCommand } from "../commands/appCommands";
import { ariaKeyShortcut, commandDefinitions } from "../commands/commandBindings";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import type { QuickActionRegistration } from "../quick-actions/quickActions";
import { useLibrarySeriesState } from "../series/useLibrarySeriesState";
import { hasActiveLibraryFilters } from "./libraryFilters";
import { useLibraryDerivedState } from "./libraryDerivedState";
import { preloadAboutDialog } from "./libraryLazySurfaces";
import { LibraryWorkspaceDialogs } from "./LibraryWorkspaceDialogs";
import { LibraryWorkspaceSurface } from "./LibraryWorkspaceSurface";
import type { LibrarySelectionIntent } from "./librarySelection";
import { pruneUnavailableLibraryMetadataFilters } from "./libraryFilters";
import { useLibraryBookActions } from "./useLibraryBookActions";
import { useLibraryBulkActions } from "./useLibraryBulkActions";
import { createArchiveOperationWarningFeedbackToken } from "./libraryFeedback";
import { useLibraryFeedback } from "./useLibraryFeedback";
import { useLibrarySelection } from "./useLibrarySelection";
import {
  libraryLocationKey,
  useLibraryWorkspaceNavigation,
  useLibraryWorkspaceNavigationLifecycle,
} from "./useLibraryWorkspaceNavigation";
import { useLibraryWorkspaceData } from "./useLibraryWorkspaceData";
import { useLibraryWorkspaceDialogs } from "./useLibraryWorkspaceDialogs";
import { useLibraryMutationFocus } from "./useLibraryMutationFocus";
import { useCollectionDisplayPreferences } from "./useCollectionDisplayPreferences";
import { useLibraryViewPreferences } from "./useLibraryViewPreferences";
import { startupTrace } from "../../app/startupTrace";
import { createLibraryCollectionQuickActions } from "./libraryCollectionQuickActions";
import { duplicateGroupBooks } from "./libraryDuplicatesReadModel";
import { epubIssueBooks } from "./libraryEpubIssuesReadModel";
import { useLibraryIntegrity } from "./useLibraryIntegrity";

type ReadyArchiveState = Extract<ArchiveState, { status: "ready" }>;

const BOOK_CONTEXT_MENU_UNAVAILABLE_FEEDBACK_ID = "book-context-menu-unavailable";

function locationEmptyState(location: LibraryLocation, libraryTitle: string) {
  if (location.type === "favorites") {
    return { title: "No favorites yet", description: "Mark books as favorites to keep them here." };
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

export function LibraryPage() {
  const archive = useArchive();
  if (archive.status !== "ready") return null;
  return <LibraryPageContent key={archive.archive.id} archive={archive} />;
}

function LibraryPageContent({ archive }: { archive: ReadyArchiveState }) {
  const activeArchive = archive.archive;
  const storage = useLibraryStorage();
  const { getCommandBinding, openPalette, openSettings, preloadSettings } = useQuickActions();
  const focusSearchAriaKeyShortcuts = ariaKeyShortcut(
    getCommandBinding(commandDefinitions.focusSearch.id),
  );
  const libraryPreferences = useLibraryPreferences();
  const booksDisplayPreferences = useBooksCollectionPreferences();
  const foldersDisplayPreferences = useFoldersCollectionPreferences();
  const seriesDisplayPreferences = useSeriesCollectionPreferences();
  const globalImportPreferences = useImportPreferences();
  const confirmDestructiveFileActions = useConfirmDestructiveFileActionsPreference();
  const showContinueReading = useShowContinueReadingPreference();
  const {
    beginOperation: beginFeedbackOperation,
    dismiss: dismissFeedback,
    publishOperation: publishFeedbackOperation,
    push: pushFeedback,
    showError: showLibraryError,
    tokens: feedbackTokens,
  } = useLibraryFeedback();
  const contextMenuUnavailableFeedbackActiveRef = useRef(false);

  useEffect(() => {
    if (!feedbackTokens.some((token) => token.id === BOOK_CONTEXT_MENU_UNAVAILABLE_FEEDBACK_ID)) {
      contextMenuUnavailableFeedbackActiveRef.current = false;
    }
  }, [feedbackTokens]);

  const announceContextMenuUnavailable = useCallback(
    (reason: string) => {
      if (contextMenuUnavailableFeedbackActiveRef.current) return;
      contextMenuUnavailableFeedbackActiveRef.current = true;
      pushFeedback({
        autoDismiss: true,
        id: BOOK_CONTEXT_MENU_UNAVAILABLE_FEEDBACK_ID,
        title: reason,
        tone: "warning",
      });
    },
    [pushFeedback],
  );

  useEffect(
    () =>
      storage.observeOperationWarnings?.({
        next: (warning) => pushFeedback(createArchiveOperationWarningFeedbackToken(warning)),
      }),
    [pushFeedback, storage],
  );

  const handleArchiveLoadError = useCallback(
    () => showLibraryError("The active archive could not be loaded."),
    [showLibraryError],
  );
  const handleWatcherError = useCallback(
    (message: string) => {
      pushFeedback({ id: "watcher-error", tone: "error", title: message });
    },
    [pushFeedback],
  );
  const {
    archiveImportSettings,
    books,
    booksLoadState,
    folders,
    libraryArchiveGeneration,
    libraryRevision,
  } = useLibraryWorkspaceData({
    archiveId: activeArchive.id,
    archiveRootPath: activeArchive.rootPath,
    storage,
    watcherError: archive.watcherError,
    onArchiveLoadError: handleArchiveLoadError,
    onWatcherError: handleWatcherError,
  });
  const integrity = useLibraryIntegrity({
    archiveGeneration: libraryArchiveGeneration,
    archiveRootPath: activeArchive.rootPath,
    books,
  });

  useLayoutEffect(() => {
    startupTrace.mark("library-render");
  }, []);

  useLayoutEffect(() => {
    if (booksLoadState.status === "ready") {
      startupTrace.mark("library-usable");
    }
  }, [booksLoadState.status]);

  useLayoutEffect(() => {
    // The ready workspace data comes from one archive-scoped, versioned Library snapshot.
    if (
      booksLoadState.status === "ready" &&
      booksLoadState.archiveId === activeArchive.id &&
      folders !== undefined
    ) {
      startupTrace.mark("library-snapshot");
    }
  }, [activeArchive.id, booksLoadState, folders]);

  const {
    clear: clearSelection,
    deselectVisible,
    enterMode: enterSelectionMode,
    exitMode: exitSelectionMode,
    retain: retainSelection,
    selectVisible,
    selectedBookIds,
    selectionMode,
    toggleBook: toggleBookSelection,
  } = useLibrarySelection(books);
  const { actions: dialogActions, dialog } = useLibraryWorkspaceDialogs();
  const smartViewPreferences = libraryPreferences.smartViews;
  const navigation = useLibraryWorkspaceNavigation({
    activeArchiveId: activeArchive.id,
    beforeArchiveSwitch: exitSelectionMode,
    folders,
    smartViewPreferences,
  });
  const {
    changeLocation: navigateToLocation,
    openBookSearch,
    openReader,
    scrollMainContentToTop,
  } = navigation;
  const duplicateIntegrityStatus = integrity.duplicates.status;
  const diagnosticIntegrityStatus = integrity.diagnostics.status;
  const refreshDuplicates = integrity.refreshDuplicates;
  const refreshDiagnostics = integrity.refreshDiagnostics;
  useEffect(() => {
    if (booksLoadState.status !== "ready") return;
    if (navigation.location.type === "duplicates" && duplicateIntegrityStatus === "idle") {
      void refreshDuplicates();
    }
    if (navigation.location.type === "epub-issues" && diagnosticIntegrityStatus === "idle") {
      void refreshDiagnostics();
    }
  }, [
    booksLoadState.status,
    diagnosticIntegrityStatus,
    duplicateIntegrityStatus,
    navigation.location.type,
    refreshDiagnostics,
    refreshDuplicates,
  ]);
  const [seriesReturnFocusKey, setSeriesReturnFocusKey] = useState<string | null>(null);
  const pendingEntryFocusKeyRef = useRef<string | null>(null);
  const changeLocation = useCallback(
    (nextLocation: LibraryLocation) => {
      const preservesSeriesOrigin =
        nextLocation.type === "series-detail" ||
        (navigation.location.type === "series-detail" && nextLocation.type === "series");
      if (!preservesSeriesOrigin) setSeriesReturnFocusKey(null);
      navigateToLocation(nextLocation);
    },
    [navigateToLocation, navigation.location.type],
  );
  const enterLocation = useCallback(
    (nextLocation: LibraryLocation) => {
      const returnsToSeriesOrigin =
        navigation.location.type === "series-detail" && nextLocation.type === "series";
      if (
        !returnsToSeriesOrigin &&
        libraryLocationKey(navigation.location) !== libraryLocationKey(nextLocation)
      ) {
        pendingEntryFocusKeyRef.current = libraryLocationKey(nextLocation);
      }
      changeLocation(nextLocation);
    },
    [changeLocation, navigation.location],
  );
  useLayoutEffect(() => {
    const locationKey = libraryLocationKey(navigation.location);
    if (pendingEntryFocusKeyRef.current !== locationKey) return;

    pendingEntryFocusKeyRef.current = null;
    navigation.pageShellRef.current?.focus({ preventScroll: true });
  }, [navigation.location, navigation.pageShellRef]);
  const debouncedQuery = useDebouncedValue(navigation.query, 150);
  const filters = libraryPreferences.filters;
  const sort = booksDisplayPreferences.sortBy;
  const view = booksDisplayPreferences.viewMode;
  const hasFilters = hasActiveLibraryFilters(filters);
  const importSettings: ImportSettings = {
    ...globalImportPreferences,
    ...archiveImportSettings,
  };
  const {
    continuePreview,
    currentFolder,
    effectiveSort,
    filterOptions,
    folderEntries,
    index,
    libraryTitle,
    visibleBooks,
  } = useLibraryDerivedState({
    archiveGeneration: libraryArchiveGeneration,
    books,
    debouncedQuery,
    filters,
    folders,
    location: navigation.location,
    libraryRevision,
    smartViewPreferences,
    sort,
  });
  const { activeSeries, entries: seriesEntries } = useLibrarySeriesState(
    index,
    navigation.location,
  );
  const returnRestoration = useLibraryWorkspaceNavigationLifecycle({
    activeSeriesExists: Boolean(activeSeries),
    booksReady: booksLoadState.status === "ready",
    changeLocation,
    location: navigation.location,
    pageShellRef: navigation.pageShellRef,
    restoreContext: navigation.restoreContext,
    returnContextRestoredRef: navigation.returnContextRestoredRef,
    visibleBooks,
  });
  const mutationVisibleBooks = useMemo(() => {
    if (navigation.location.type === "duplicates") {
      return duplicateGroupBooks(books ?? [], integrity.duplicates.snapshot);
    }
    if (navigation.location.type === "epub-issues") {
      return epubIssueBooks(books ?? [], integrity.diagnostics.snapshot);
    }
    return visibleBooks;
  }, [
    books,
    integrity.diagnostics.snapshot,
    integrity.duplicates.snapshot,
    navigation.location.type,
    visibleBooks,
  ]);

  const {
    beginBookMutation,
    beginFolderDeletion,
    captureBook: captureBookMutationFocus,
    captureFolderDeletion,
    collectionRequest: mutationFocusRequest,
    completeBookMutation,
    completeFolderDeletion,
  } = useLibraryMutationFocus({
    activeArchiveId: activeArchive.id,
    dialogOpen: dialog.type !== "none",
    fallbackRef:
      navigation.location.type === "duplicates"
        ? navigation.pageShellRef
        : navigation.searchInputRef,
    folders: folders ?? [],
    locationKey: libraryLocationKey(navigation.location),
    visibleBooks: mutationVisibleBooks,
  });

  const { changeFilters, changeSort, changeView } = useLibraryViewPreferences({
    showLibraryError,
  });
  const { changeFolderSort, changeFolderView, changeSeriesSort, changeSeriesView } =
    useCollectionDisplayPreferences({ showLibraryError });

  useEffect(() => {
    if (booksLoadState.status !== "ready" || booksLoadState.archiveId !== activeArchive.id) return;
    const nextFilters = pruneUnavailableLibraryMetadataFilters(filters, filterOptions);
    if (nextFilters !== filters) changeFilters(nextFilters);
  }, [activeArchive.id, booksLoadState, changeFilters, filterOptions, filters]);

  const selectionReturnFocusRef = useRef<HTMLElement | null>(null);
  const leaveSelectionMode = useCallback(() => {
    exitSelectionMode();
    const returnFocus = selectionReturnFocusRef.current;
    selectionReturnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (!focusElementIfRestorationOwned(returnFocus, { invalidatedOrigin: returnFocus })) {
        focusElementIfRestorationOwned(navigation.searchInputRef.current, {
          invalidatedOrigin: returnFocus,
        });
      }
    });
  }, [exitSelectionMode, navigation.searchInputRef]);
  const toggleSelectionMode = useCallback(() => {
    if (selectionMode) {
      leaveSelectionMode();
      return;
    }
    selectionReturnFocusRef.current = currentFocusOrigin() ?? navigation.searchInputRef.current;
    enterSelectionMode();
  }, [enterSelectionMode, leaveSelectionMode, navigation.searchInputRef, selectionMode]);
  const changeBookSelection = useCallback(
    (book: LibrarySnapshotBook, intent: LibrarySelectionIntent) => {
      if (!selectionMode) {
        selectionReturnFocusRef.current = currentFocusOrigin() ?? navigation.searchInputRef.current;
      }
      toggleBookSelection(book, intent, visibleBooks);
    },
    [navigation.searchInputRef, selectionMode, toggleBookSelection, visibleBooks],
  );

  useEffect(() => {
    if (!selectionMode) return;
    function handleSelectionEscape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector("dialog[open], details[open]")
      ) {
        return;
      }
      event.preventDefault();
      leaveSelectionMode();
    }
    document.addEventListener("keydown", handleSelectionEscape);
    return () => document.removeEventListener("keydown", handleSelectionEscape);
  }, [leaveSelectionMode, selectionMode]);

  const clearFilters = useCallback(() => {
    changeFilters(createDefaultLibraryFilters());
    scrollMainContentToTop();
  }, [changeFilters, scrollMainContentToTop]);

  const readerReturnLabel = isLibraryIntegrityLocation(navigation.location)
    ? libraryIntegrityLocationLabel(navigation.location)
    : navigation.query.trim()
      ? "Search results"
      : navigation.location.type === "folders"
        ? "Folders"
        : navigation.location.type === "series"
          ? "Series"
          : navigation.location.type === "series-detail"
            ? (activeSeries?.displayName ?? "Series")
            : libraryTitle;
  const readBook = useCallback(
    (book: LibrarySnapshotBook) => openReader(book, readerReturnLabel),
    [openReader, readerReturnLabel],
  );
  const readBookFromBeginning = useCallback(
    (book: LibrarySnapshotBook) => openReader(book, readerReturnLabel, true),
    [openReader, readerReturnLabel],
  );
  const captureFolderMutationFocus = navigation.captureFolderMutationFocus;
  const openRenameFolder = useCallback(
    (folder: LibrarySnapshotFolder) => {
      captureFolderMutationFocus(folder);
      dialogActions.openRenameFolder(folder);
    },
    [captureFolderMutationFocus, dialogActions],
  );
  const openMoveFolder = useCallback(
    (folder: LibrarySnapshotFolder) => {
      captureFolderMutationFocus(folder);
      dialogActions.openMoveFolder(folder);
    },
    [captureFolderMutationFocus, dialogActions],
  );

  const bookActions = useLibraryBookActions({
    beginBookMutation,
    beginFeedbackOperation,
    beginFolderDeletion,
    changeLocation,
    confirmDestructiveFileActions,
    currentFolder,
    dialogs: dialogActions,
    dismissFeedback,
    location: navigation.location,
    onBookMutationComplete: completeBookMutation,
    onFolderDeletionComplete: completeFolderDeletion,
    publishFeedbackOperation,
    runFolderPathMutation: navigation.runFolderPathMutation,
    storage,
  });
  const openBookDetails = useCallback(
    (book: LibrarySnapshotBook) => {
      captureBookMutationFocus(book);
      dialogActions.openBookDetails(book);
    },
    [captureBookMutationFocus, dialogActions],
  );
  const openBookMetadata = useCallback(
    (book: LibrarySnapshotBook) => {
      captureBookMutationFocus(book);
      dialogActions.openBookMetadata(book);
    },
    [captureBookMutationFocus, dialogActions],
  );
  const openMoveBook = useCallback(
    (book: LibrarySnapshotBook) => {
      captureBookMutationFocus(book);
      dialogActions.openMoveBook(book);
    },
    [captureBookMutationFocus, dialogActions],
  );
  const openRenameBook = useCallback(
    (book: LibrarySnapshotBook) => {
      captureBookMutationFocus(book);
      dialogActions.openRenameBook(book);
    },
    [captureBookMutationFocus, dialogActions],
  );
  const requestDeleteBookAction = bookActions.requestDeleteBook;
  const toggleFavoriteAction = bookActions.toggleFavorite;
  const requestDeleteFolderAction = bookActions.requestDeleteFolder;
  const requestDeleteBook = useCallback(
    (book: LibrarySnapshotBook) => {
      captureBookMutationFocus(book);
      requestDeleteBookAction(book);
    },
    [captureBookMutationFocus, requestDeleteBookAction],
  );
  const toggleFavorite = useCallback(
    (book: LibrarySnapshotBook) => {
      captureBookMutationFocus(book);
      return toggleFavoriteAction(book);
    },
    [captureBookMutationFocus, toggleFavoriteAction],
  );
  const requestDeleteFolder = useCallback(
    (folder: LibrarySnapshotFolder) => {
      captureFolderDeletion(folder);
      requestDeleteFolderAction(folder);
    },
    [captureFolderDeletion, requestDeleteFolderAction],
  );
  const openFolder = useCallback(
    (folder: LibrarySnapshotFolder) => enterLocation({ type: "folder", folderId: folder.id }),
    [enterLocation],
  );
  const revealFolderAction = bookActions.revealFolder;
  const revealFolder = useCallback(
    (folder: LibrarySnapshotFolder) => void revealFolderAction(folder),
    [revealFolderAction],
  );
  const setSeriesQuery = navigation.setSeriesQuery;
  const clearSeriesSearch = useCallback(() => setSeriesQuery(""), [setSeriesQuery]);
  const openSeries = useCallback(
    (entry: SeriesEntry) => {
      setSeriesReturnFocusKey(entry.key);
      enterLocation({ type: "series-detail", seriesKey: entry.key });
    },
    [enterLocation],
  );
  const completeSeriesReturnFocus = useCallback(() => setSeriesReturnFocusKey(null), []);
  const returnToSeriesOverview = useCallback(() => {
    setSeriesReturnFocusKey(activeSeries?.key ?? null);
    enterLocation({ type: "series" });
  }, [activeSeries?.key, enterLocation]);
  const visibleSelectedCount = useMemo(
    () => visibleBooks.reduce((count, book) => count + Number(selectedBookIds.has(book.id)), 0),
    [selectedBookIds, visibleBooks],
  );
  const bulkActions = useLibraryBulkActions({
    beginFeedbackOperation,
    books,
    dialogs: dialogActions,
    dismissFeedback,
    leaveSelectionMode,
    publishFeedbackOperation,
    retainSelection,
    selectedBookIds,
    storage,
  });

  const handleExternalDrop = useCallback(
    (sourcePaths: string[], destinationValue: string) => {
      dialogActions.openAddEpub({
        destinationFolderPath: destinationValueToFolderPath(destinationValue),
        sourcePaths,
      });
    },
    [dialogActions],
  );
  const handleInvalidExternalDrop = useCallback(
    (message: string) => {
      pushFeedback({
        id: "external-import-drop",
        tone: "error",
        title: "These items cannot be added.",
        detail: message,
      });
    },
    [pushFeedback],
  );
  const { activeTarget: activeImportDropTarget } = useExternalEpubDrop({
    onDrop: handleExternalDrop,
    onInvalidDrop: handleInvalidExternalDrop,
  });

  const openArchiveManager = useCallback(() => void archiveStore.openArchiveManagerWindow(), []);
  const revealActiveArchive = useCallback(
    () => void archiveStore.revealActiveArchive(activeArchive),
    [activeArchive],
  );
  const folderSearchInputRef = useRef<HTMLInputElement>(null);
  const seriesSearchInputRef = useRef<HTMLInputElement>(null);
  const searchSurfaceAvailable =
    navigation.location.type !== "duplicates" &&
    navigation.location.type !== "epub-issues" &&
    navigation.location.type !== "series-detail";
  const focusActiveSearch = useCallback(() => {
    if (navigation.location.type === "folders") {
      folderSearchInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (navigation.location.type === "series") {
      seriesSearchInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (navigation.location.type === "duplicates" || navigation.location.type === "epub-issues") {
      return;
    }
    openBookSearch();
  }, [navigation.location.type, openBookSearch]);
  const activeSearchScope: AppCommand["scope"] =
    navigation.location.type === "folders" ? "folders" : "library";
  const collectionQuickActions = useMemo(
    () =>
      createLibraryCollectionQuickActions({
        collections: {
          books: booksDisplayPreferences,
          folders: foldersDisplayPreferences,
          series: seriesDisplayPreferences,
        },
        location: navigation.location,
        updateCollection: (collection, changes) =>
          appPreferencesStore.updateLibraryCollection(collection, changes),
      }),
    [
      booksDisplayPreferences,
      foldersDisplayPreferences,
      navigation.location,
      seriesDisplayPreferences,
    ],
  );
  const quickActionCommands = useMemo<QuickActionRegistration[]>(
    () => [
      {
        ...commandDefinitions.focusSearch,
        availability: searchSurfaceAvailable
          ? { available: true }
          : { available: false, reason: "This surface does not have search." },
        execute: focusActiveSearch,
        order: 40,
        scope: activeSearchScope,
      },
      ...(navigation.location.type === "folders" ||
      navigation.location.type === "series" ||
      navigation.location.type === "series-detail"
        ? [
            {
              configuration: "unbound" as const,
              execute: openBookSearch,
              group: "Library" as const,
              id: "library.search-books",
              keywords: ["find books", "search library"],
              label: "Search books",
              order: 41,
              scope: activeSearchScope,
            },
          ]
        : []),
      ...collectionQuickActions,
      {
        configuration: "unbound",
        execute: () => enterLocation({ type: "library" }),
        group: "Navigate",
        id: "navigate.library",
        keywords: ["go to collection", "home"],
        label: "Go to Library",
        order: 50,
        scope: "library",
      },
      ...(isLibrarySmartViewVisible(smartViewPreferences, "in-progress")
        ? [
            {
              configuration: "unbound" as const,
              execute: () => enterLocation({ type: "continue" }),
              group: "Navigate" as const,
              id: "navigate.continue",
              keywords: ["in progress", "continue reading"],
              label: "Go to Continue",
              order: 51,
              scope: "library" as const,
            },
          ]
        : []),
      {
        configuration: "unbound",
        execute: () => enterLocation({ type: "favorites" }),
        group: "Navigate",
        id: "navigate.favorites",
        keywords: ["favorite books", "starred"],
        label: "Go to Favorites",
        order: 52,
        scope: "library",
      },
      {
        configuration: "unbound",
        execute: () => enterLocation({ type: "folders" }),
        group: "Navigate",
        id: "navigate.folders",
        keywords: ["browse folders", "organization"],
        label: "Go to Folders",
        order: 53,
        scope: "library",
      },
      {
        configuration: "unbound",
        execute: () => enterLocation({ type: "series" }),
        group: "Navigate",
        id: "navigate.series",
        keywords: ["browse series", "collections"],
        label: "Go to Series",
        order: 54,
        scope: "library",
      },
      ...(isLibrarySmartViewVisible(smartViewPreferences, "duplicates")
        ? [
            {
              configuration: "unbound" as const,
              execute: () => enterLocation({ type: "duplicates" }),
              group: "Navigate" as const,
              id: "navigate.duplicates",
              keywords: ["duplicate books", "archive integrity"],
              label: "Go to Duplicates",
              order: 55,
              scope: "library" as const,
            },
          ]
        : []),
      ...(isLibrarySmartViewVisible(smartViewPreferences, "epub-issues")
        ? [
            {
              configuration: "unbound" as const,
              execute: () => enterLocation({ type: "epub-issues" }),
              group: "Navigate" as const,
              id: "navigate.epub-issues",
              keywords: ["epub diagnostics", "archive integrity", "book issues"],
              label: "Go to EPUB Issues",
              order: 56,
              scope: "library" as const,
            },
          ]
        : []),
      {
        availability: bookActions.isImporting
          ? { available: false, reason: "Wait for the current EPUB import to finish." }
          : { available: true },
        configuration: "unbound",
        execute: () => dialogActions.openAddEpub(),
        group: "Library",
        id: "library.add-epubs",
        keywords: ["import books", "add files"],
        label: "Add EPUBs",
        order: 60,
        scope: "library",
      },
      {
        configuration: "unbound",
        execute: dialogActions.openCreateFolder,
        group: "Library",
        id: "library.create-folder",
        keywords: ["new folder", "organize books"],
        label: "Create folder",
        order: 61,
        scope: "library",
      },
      {
        availability: bookActions.isRescanning
          ? { available: false, reason: "Wait for the archive scan to finish." }
          : { available: true },
        configuration: "unbound",
        execute: dialogActions.openRescan,
        group: "Library",
        id: "library.rescan",
        keywords: ["refresh archive", "scan files"],
        label: "Rescan archive",
        order: 62,
        scope: "library",
      },
    ],
    [
      activeSearchScope,
      bookActions.isImporting,
      bookActions.isRescanning,
      collectionQuickActions,
      dialogActions,
      enterLocation,
      focusActiveSearch,
      navigation.location.type,
      openBookSearch,
      searchSurfaceAvailable,
      smartViewPreferences,
    ],
  );
  useRegisterQuickActions("library", quickActionCommands);

  const emptyState = locationEmptyState(navigation.location, libraryTitle);
  const currentImportDropDestination = currentFolder?.relativePath ?? ARCHIVE_ROOT_DESTINATION;

  return (
    <>
      <LibraryWorkspaceSurface
        bookFocusFallbackRef={navigation.searchInputRef}
        books={books}
        bookCollectionProps={{
          canManageFile: true,
          onDelete: requestDeleteBook,
          onEditMetadata: openBookMetadata,
          onMove: openMoveBook,
          onRead: readBook,
          onRenameFile: openRenameBook,
          onRevealFile: bookActions.revealBookFile,
          onSelect: openBookDetails,
          onSelectionChange: changeBookSelection,
          onToggleFavorite: toggleFavorite,
          onContextMenuUnavailable: announceContextMenuUnavailable,
          selectedBookIds,
          selectionMode,
        }}
        continuePreview={continuePreview}
        debouncedQuery={debouncedQuery}
        duplicatesViewProps={{
          books: books ?? [],
          onDelete: requestDeleteBook,
          onMove: openMoveBook,
          onOpenDetails: openBookDetails,
          onRead: readBook,
          onRefresh: integrity.refreshDuplicates,
          onReveal: bookActions.revealBookFile,
          state: integrity.duplicates,
        }}
        epubIssuesViewProps={{
          books: books ?? [],
          onOpenDetails: openBookDetails,
          onRead: readBook,
          onRefresh: integrity.refreshDiagnostics,
          onReveal: bookActions.revealBookFile,
          state: integrity.diagnostics,
        }}
        emptyState={emptyState}
        feedbackProps={{ onDismiss: dismissFeedback, tokens: feedbackTokens }}
        folderBrowserProps={{
          activeImportDropTargetId: activeImportDropTarget?.id,
          canManageFolders: true,
          canRevealFolders: true,
          entries: folderEntries,
          isLoading: booksLoadState.status === "loading",
          onCreate: dialogActions.openCreateFolder,
          onDelete: requestDeleteFolder,
          onMove: openMoveFolder,
          onOpen: openFolder,
          onRename: openRenameFolder,
          onReveal: revealFolder,
          cardSize: foldersDisplayPreferences.cardSize,
          onSortChange: changeFolderSort,
          onViewChange: changeFolderView,
          searchAriaKeyShortcuts: focusSearchAriaKeyShortcuts,
          searchInputRef: folderSearchInputRef,
          sort: foldersDisplayPreferences.sortBy,
          view: foldersDisplayPreferences.viewMode,
        }}
        hasFilters={hasFilters}
        importDropTarget={{
          active: activeImportDropTarget?.id === "current-library-surface",
          destination: currentImportDropDestination,
          id: "current-library-surface",
          label: currentFolder?.name ?? "Archive root",
        }}
        isImporting={bookActions.isImporting}
        isLoading={booksLoadState.status === "loading"}
        location={navigation.location}
        mainRef={navigation.pageShellRef}
        focusOwnershipKey={`${activeArchive.id}:${libraryLocationKey(navigation.location)}`}
        onMountedReturnSurfaceReady={returnRestoration.onMountedSurfaceReady}
        returnFocusRequest={returnRestoration.collectionRequest ?? mutationFocusRequest}
        onClearFilters={clearFilters}
        onClearLibrarySearch={navigation.clearLibrarySearch}
        selectionBarProps={
          selectionMode
            ? {
                busy: bulkActions.isBulkRunning,
                onAction: bulkActions.handleBulkAction,
                onClear: clearSelection,
                onDeselectVisible: () => deselectVisible(visibleBooks),
                onExit: leaveSelectionMode,
                onSelectVisible: () => selectVisible(visibleBooks),
                selectedCount: selectedBookIds.size,
                visibleCount: visibleBooks.length,
                visibleSelectedCount,
              }
            : null
        }
        seriesDetailProps={{
          entry: activeSeries,
          onBack: returnToSeriesOverview,
          onRead: readBook,
        }}
        seriesOverviewProps={{
          entries: seriesEntries,
          isLoading: booksLoadState.status === "loading",
          onClearSearch: clearSeriesSearch,
          onOpen: openSeries,
          onReturnFocusComplete: completeSeriesReturnFocus,
          returnFocusKey: seriesReturnFocusKey,
          cardSize: seriesDisplayPreferences.cardSize,
          onQueryChange: setSeriesQuery,
          onSortChange: changeSeriesSort,
          onViewChange: changeSeriesView,
          query: navigation.seriesQuery,
          searchAriaKeyShortcuts: focusSearchAriaKeyShortcuts,
          searchInputRef: seriesSearchInputRef,
          sort: seriesDisplayPreferences.sortBy,
          view: seriesDisplayPreferences.viewMode,
        }}
        showContinueReading={showContinueReading}
        sidebarProps={{
          activeArchive,
          activeImportDropTargetId: activeImportDropTarget?.id,
          archives: archive.archives,
          canManageFolders: true,
          canRevealFolders: true,
          folderSort: foldersDisplayPreferences.sortBy,
          folderEntries,
          location: navigation.location,
          onCreateFolder: dialogActions.openCreateFolder,
          onDeleteFolder: requestDeleteFolder,
          onFolderSortChange: changeFolderSort,
          onLocationChange: enterLocation,
          onManageArchives: openArchiveManager,
          onMoveFolder: openMoveFolder,
          onOpenAbout: dialogActions.openAbout,
          onOpenSettings: openSettings,
          onPreloadAbout: preloadAboutDialog,
          onPreloadSettings: preloadSettings,
          settingsAriaKeyShortcuts: ariaKeyShortcut(
            getCommandBinding(commandDefinitions.settings.id),
          ),
          onRenameFolder: openRenameFolder,
          onRevealFolder: revealFolder,
          onSwitchArchive: (knownArchive) => void navigation.switchArchive(knownArchive.id),
          smartViewPreferences,
        }}
        titlebarCompositionProps={{
          onOpenQuickActions: openPalette,
          onRevealArchive: revealActiveArchive,
          quickActionsAriaKeyShortcuts: ariaKeyShortcut(
            getCommandBinding(commandDefinitions.quickActions.id),
          ),
          revealArchiveDisabledReason: activeArchive.rootPath.trim()
            ? undefined
            : "The active archive folder is unavailable.",
        }}
        toolbarProps={{
          filterOptions,
          filters,
          isImporting: bookActions.isImporting,
          isRescanning: bookActions.isRescanning,
          onClearFilters: clearFilters,
          onClearSearch: navigation.clearLibrarySearch,
          onFilterChange: changeFilters,
          onOpenAddEpub: () => dialogActions.openAddEpub(),
          onQueryChange: navigation.setQuery,
          onRescan: bookActions.rescanLibrary,
          onSortChange: changeSort,
          onToggleSelectionMode: toggleSelectionMode,
          onViewChange: changeView,
          query: navigation.query,
          searchAriaKeyShortcuts: focusSearchAriaKeyShortcuts,
          resultCount: visibleBooks.length,
          searchInputRef: navigation.searchInputRef,
          selectionMode,
          sort: effectiveSort,
          title: libraryTitle,
          view,
        }}
        bookCardSize={booksDisplayPreferences.cardSize}
        view={view}
        visibleBooks={visibleBooks}
      />

      <LibraryWorkspaceDialogs
        books={books}
        confirmDestructiveFileActions={confirmDestructiveFileActions}
        currentFolder={currentFolder}
        dialog={dialog}
        dialogActions={dialogActions}
        folders={folders}
        importDefaults={importSettings}
        isBulkRunning={bulkActions.isBulkRunning}
        isClearingProgress={bookActions.isClearingProgress}
        isDeleting={bookActions.isDeleting}
        isImporting={bookActions.isImporting}
        isRescanning={bookActions.isRescanning}
        onConfirmClearProgress={bookActions.confirmClearProgress}
        onCreateFolder={bookActions.createFolder}
        onDeleteBook={bookActions.deleteBook}
        onDeleteFolder={bookActions.deleteFolder}
        onDeleteSelectedBooks={bulkActions.deleteSelectedBooks}
        onImport={bookActions.importEpubs}
        onMoveBook={bookActions.moveBook}
        onMoveFolder={bookActions.moveFolder}
        onMoveSelectedBooks={bulkActions.moveSelectedBooks}
        onPrepareBookCover={bookActions.prepareBookCover}
        onReadBook={readBook}
        onReadBookFromBeginning={readBookFromBeginning}
        onRenameBookFile={bookActions.renameBookFile}
        onRenameFolder={bookActions.renameFolder}
        onRequestClearProgress={dialogActions.openClearProgress}
        onRequestDeleteBook={bookActions.requestDeleteBook}
        onRescan={bookActions.rescanLibrary}
        onRevealBookFile={bookActions.revealBookFile}
        onToggleFavorite={bookActions.toggleFavorite}
        onWriteBookCover={bookActions.writeBookCover}
        onWriteBookMetadata={bookActions.writeBookMetadata}
        onWriteSelectedBookMetadata={bulkActions.writeSelectedBookMetadata}
        selectedBookIds={selectedBookIds}
        selectedBooks={bulkActions.selectedBooks}
      />
    </>
  );
}
