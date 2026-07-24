import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ArchiveState } from "../../stores/archiveStore";
import { archiveStore } from "../../stores/archiveStore";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  useBooksCollectionPreferences,
  useConfirmDestructiveFileActionsPreference,
  useFoldersCollectionPreferences,
  useImportPreferences,
  useLibraryPreferences,
  useSeriesCollectionPreferences,
  useShowContinueReadingPreference,
} from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type { LibraryLocation } from "../../types/library";
import { createDefaultLibraryFilters } from "../../types/library";
import { isLibrarySmartViewVisible } from "../../types/librarySmartViews";
import type { ImportSettings } from "../../types/settings";
import { currentFocusOrigin, focusElementIfRestorationOwned } from "../../utils/focusRestoration";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { useArchive } from "../archive/useArchive";
import {
  ARCHIVE_ROOT_DESTINATION,
  destinationValueToFolderPath,
} from "../filesystem/archiveImport";
import { useExternalEpubDrop } from "../filesystem/useExternalEpubDrop";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import { ariaKeyShortcut, commandDefinitions } from "../quick-actions/commandBindings";
import type { QuickActionCommand } from "../quick-actions/quickActions";
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
  const { getCommandBinding, openSettings, preloadSettings } = useQuickActions();
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
  const { archiveImportSettings, books, booksLoadState, folders } = useLibraryWorkspaceData({
    archiveId: activeArchive.id,
    storage,
    watcherError: archive.watcherError,
    onArchiveLoadError: handleArchiveLoadError,
    onWatcherError: handleWatcherError,
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
    // Books and Folders are separate streams with no shared revision. This is the first observed
    // co-ready boundary, not proof that both values came from one atomic archive commit.
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
  const [seriesReturnFocusKey, setSeriesReturnFocusKey] = useState<string | null>(null);
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
    bookCount,
    bookCountsByFolder,
    continuePreview,
    currentFolder,
    effectiveSort,
    favoriteCount,
    filterOptions,
    index,
    libraryTitle,
    smartViewCounts,
    visibleBooks,
  } = useLibraryDerivedState({
    books,
    debouncedQuery,
    filters,
    folders,
    location: navigation.location,
    smartViewPreferences,
    sort,
  });
  const {
    activeSeries,
    entries: seriesEntries,
    seriesCount,
  } = useLibrarySeriesState(index, navigation.location);
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
    fallbackRef: navigation.searchInputRef,
    folders: folders ?? [],
    locationKey: libraryLocationKey(navigation.location),
    visibleBooks,
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
    (book: Book, intent: LibrarySelectionIntent) => {
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

  const readerReturnLabel = navigation.query.trim()
    ? "Search results"
    : navigation.location.type === "folders"
      ? "Folders"
      : navigation.location.type === "series"
        ? "Series"
        : navigation.location.type === "series-detail"
          ? (activeSeries?.displayName ?? "Series")
          : libraryTitle;
  const readBook = useCallback(
    (book: Book) => openReader(book, readerReturnLabel),
    [openReader, readerReturnLabel],
  );
  const readBookFromBeginning = useCallback(
    (book: Book) => openReader(book, readerReturnLabel, true),
    [openReader, readerReturnLabel],
  );
  const openRenameFolder = useCallback(
    (folder: Folder) => {
      navigation.captureFolderMutationFocus(folder);
      dialogActions.openRenameFolder(folder);
    },
    [dialogActions, navigation],
  );
  const openMoveFolder = useCallback(
    (folder: Folder) => {
      navigation.captureFolderMutationFocus(folder);
      dialogActions.openMoveFolder(folder);
    },
    [dialogActions, navigation],
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
    (book: Book) => {
      captureBookMutationFocus(book);
      dialogActions.openBookDetails(book);
    },
    [captureBookMutationFocus, dialogActions],
  );
  const openBookMetadata = useCallback(
    (book: Book) => {
      captureBookMutationFocus(book);
      dialogActions.openBookMetadata(book);
    },
    [captureBookMutationFocus, dialogActions],
  );
  const openMoveBook = useCallback(
    (book: Book) => {
      captureBookMutationFocus(book);
      dialogActions.openMoveBook(book);
    },
    [captureBookMutationFocus, dialogActions],
  );
  const openRenameBook = useCallback(
    (book: Book) => {
      captureBookMutationFocus(book);
      dialogActions.openRenameBook(book);
    },
    [captureBookMutationFocus, dialogActions],
  );
  const requestDeleteBookAction = bookActions.requestDeleteBook;
  const toggleFavoriteAction = bookActions.toggleFavorite;
  const requestDeleteFolderAction = bookActions.requestDeleteFolder;
  const requestDeleteBook = useCallback(
    (book: Book) => {
      captureBookMutationFocus(book);
      requestDeleteBookAction(book);
    },
    [captureBookMutationFocus, requestDeleteBookAction],
  );
  const toggleFavorite = useCallback(
    (book: Book) => {
      captureBookMutationFocus(book);
      return toggleFavoriteAction(book);
    },
    [captureBookMutationFocus, toggleFavoriteAction],
  );
  const requestDeleteFolder = useCallback(
    (folder: Folder) => {
      captureFolderDeletion(folder);
      requestDeleteFolderAction(folder);
    },
    [captureFolderDeletion, requestDeleteFolderAction],
  );
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
  const folderSearchInputRef = useRef<HTMLInputElement>(null);
  const seriesSearchInputRef = useRef<HTMLInputElement>(null);
  const searchSurfaceAvailable = navigation.location.type !== "series-detail";
  const focusActiveSearch = useCallback(() => {
    if (navigation.location.type === "folders") {
      folderSearchInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (navigation.location.type === "series") {
      seriesSearchInputRef.current?.focus({ preventScroll: true });
      return;
    }
    openBookSearch();
  }, [navigation.location.type, openBookSearch]);
  const activeSearchScope: QuickActionCommand["scope"] =
    navigation.location.type === "folders" ? "folders" : "library";
  const quickActionCommands = useMemo<QuickActionCommand[]>(
    () => [
      {
        ...commandDefinitions.focusSearch,
        availability: searchSurfaceAvailable
          ? { available: true }
          : { available: false, reason: "This surface does not have search." },
        execute: focusActiveSearch,
        keywords: ["find books", "search library", "search folders", "search series"],
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
      {
        configuration: "unbound",
        execute: () => changeLocation({ type: "library" }),
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
              execute: () => changeLocation({ type: "continue" }),
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
        execute: () => changeLocation({ type: "favorites" }),
        group: "Navigate",
        id: "navigate.favorites",
        keywords: ["favorite books", "starred"],
        label: "Go to Favorites",
        order: 52,
        scope: "library",
      },
      {
        configuration: "unbound",
        execute: () => changeLocation({ type: "folders" }),
        group: "Navigate",
        id: "navigate.folders",
        keywords: ["browse folders", "organization"],
        label: "Go to Folders",
        order: 53,
        scope: "library",
      },
      {
        configuration: "unbound",
        execute: () => changeLocation({ type: "series" }),
        group: "Navigate",
        id: "navigate.series",
        keywords: ["browse series", "collections"],
        label: "Go to Series",
        order: 54,
        scope: "library",
      },
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
      changeLocation,
      dialogActions,
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
        emptyState={emptyState}
        feedbackProps={{ onDismiss: dismissFeedback, tokens: feedbackTokens }}
        folderBrowserProps={{
          activeImportDropTargetId: activeImportDropTarget?.id,
          bookCounts: bookCountsByFolder,
          canManageFolders: true,
          canRevealFolders: true,
          folders: folders ?? [],
          onCreate: dialogActions.openCreateFolder,
          onDelete: requestDeleteFolder,
          onMove: openMoveFolder,
          onOpen: (folder) => changeLocation({ type: "folder", folderId: folder.id }),
          onRename: openRenameFolder,
          onReveal: (folder) => void bookActions.revealFolder(folder),
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
          onBack: () => {
            setSeriesReturnFocusKey(activeSeries?.key ?? null);
            changeLocation({ type: "series" });
          },
          onRead: readBook,
        }}
        seriesOverviewProps={{
          entries: seriesEntries,
          isLoading: books === undefined,
          onClearSearch: () => navigation.setSeriesQuery(""),
          onOpen: (entry) => {
            setSeriesReturnFocusKey(entry.key);
            changeLocation({ type: "series-detail", seriesKey: entry.key });
          },
          onReturnFocusComplete: () => setSeriesReturnFocusKey(null),
          returnFocusKey: seriesReturnFocusKey,
          cardSize: seriesDisplayPreferences.cardSize,
          onQueryChange: navigation.setSeriesQuery,
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
          bookCount,
          canManageFolders: true,
          canRevealFolders: true,
          favoriteCount,
          folders: folders ?? [],
          location: navigation.location,
          onCreateFolder: dialogActions.openCreateFolder,
          onDeleteFolder: requestDeleteFolder,
          onLocationChange: changeLocation,
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
          onRevealFolder: (folder) => void bookActions.revealFolder(folder),
          onSwitchArchive: (knownArchive) => void navigation.switchArchive(knownArchive.id),
          seriesCount,
          smartViewCounts,
          smartViewPreferences,
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
