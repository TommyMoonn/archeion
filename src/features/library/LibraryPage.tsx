import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ArchiveState } from "../../stores/archiveStore";
import { archiveStore } from "../../stores/archiveStore";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  useAppPreferences,
  useImportPreferences,
  useLibraryPreferences,
  useShowContinueReadingPreference,
} from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type { LibraryLocation } from "../../types/library";
import { createDefaultLibraryFilters } from "../../types/library";
import type { ImportSettings } from "../../types/settings";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { useArchive } from "../archive/useArchive";
import {
  ARCHIVE_ROOT_DESTINATION,
  destinationValueToFolderPath,
} from "../filesystem/archiveImport";
import { useExternalEpubDrop } from "../filesystem/useExternalEpubDrop";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import type { QuickActionCommand } from "../quick-actions/quickActions";
import { useLibrarySeriesState } from "../series/useLibrarySeriesState";
import { createLibrarySearchIndexCache, hasActiveLibraryFilters } from "./libraryFilters";
import { useLibraryDerivedState } from "./libraryDerivedState";
import { preloadAboutDialog, useLibrarySurfacePreloading } from "./libraryLazySurfaces";
import { LibraryWorkspaceDialogs } from "./LibraryWorkspaceDialogs";
import { LibraryWorkspaceSurface } from "./LibraryWorkspaceSurface";
import type { LibrarySelectionIntent } from "./librarySelection";
import { pruneUnavailableLibraryMetadataFilters } from "./libraryFilters";
import { useLibraryBookActions } from "./useLibraryBookActions";
import { useLibraryBulkActions } from "./useLibraryBulkActions";
import { useLibraryFeedback } from "./useLibraryFeedback";
import { useLibrarySelection } from "./useLibrarySelection";
import {
  useLibraryWorkspaceNavigation,
  useLibraryWorkspaceNavigationLifecycle,
} from "./useLibraryWorkspaceNavigation";
import { useLibraryWorkspaceData } from "./useLibraryWorkspaceData";
import { useLibraryWorkspaceDialogs } from "./useLibraryWorkspaceDialogs";
import { useLibraryViewPreferences } from "./useLibraryViewPreferences";

type ReadyArchiveState = Extract<ArchiveState, { status: "ready" }>;

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
  const { openSettings, preloadSettings } = useQuickActions();
  const libraryPreferences = useLibraryPreferences();
  const globalImportPreferences = useImportPreferences();
  const { confirmDestructiveFileActions } = useAppPreferences();
  const showContinueReading = useShowContinueReadingPreference();
  const {
    dismiss: dismissFeedback,
    push: pushFeedback,
    showError: showLibraryError,
    showRescanError,
    showRescanSuccess,
    tokens: feedbackTokens,
  } = useLibraryFeedback();

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
  const navigation = useLibraryWorkspaceNavigation({
    activeArchiveId: activeArchive.id,
    beforeArchiveSwitch: exitSelectionMode,
    folders,
  });
  const { changeLocation, openBookSearch, openReader, scrollMainContentToTop } = navigation;
  useLibrarySurfacePreloading(preloadSettings);

  const debouncedQuery = useDebouncedValue(navigation.query, 150);
  const [searchIndexCache] = useState(() => createLibrarySearchIndexCache());
  const filters = libraryPreferences.filters;
  const sort = libraryPreferences.sortBy;
  const view = libraryPreferences.viewMode;
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
    libraryTitle,
    smartViewCounts,
    visibleBooks,
  } = useLibraryDerivedState({
    books,
    debouncedQuery,
    filters,
    folders,
    location: navigation.location,
    searchIndexCache,
    sort,
  });
  const {
    activeSeries,
    entries: seriesEntries,
    seriesCount,
  } = useLibrarySeriesState(books, navigation.location);

  useLibraryWorkspaceNavigationLifecycle({
    activeSeriesExists: Boolean(activeSeries),
    booksReady: booksLoadState.status === "ready",
    changeLocation,
    location: navigation.location,
    pageShellRef: navigation.pageShellRef,
    restoreContext: navigation.restoreContext,
    returnContextRestoredRef: navigation.returnContextRestoredRef,
  });

  const { changeFilters, changeSort, changeView } = useLibraryViewPreferences({
    preferences: libraryPreferences,
    showLibraryError,
  });

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
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else navigation.searchInputRef.current?.focus({ preventScroll: true });
    });
  }, [exitSelectionMode, navigation.searchInputRef]);
  const toggleSelectionMode = useCallback(() => {
    if (selectionMode) {
      leaveSelectionMode();
      return;
    }
    const activeElement = document.activeElement;
    selectionReturnFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : navigation.searchInputRef.current;
    enterSelectionMode();
  }, [enterSelectionMode, leaveSelectionMode, navigation.searchInputRef, selectionMode]);
  const changeBookSelection = useCallback(
    (book: Book, intent: LibrarySelectionIntent) => {
      if (!selectionMode) {
        const activeElement = document.activeElement;
        selectionReturnFocusRef.current =
          activeElement instanceof HTMLElement ? activeElement : navigation.searchInputRef.current;
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

  const bookActions = useLibraryBookActions({
    changeLocation,
    confirmDestructiveFileActions,
    currentFolder,
    dialogs: dialogActions,
    dismissFeedback,
    location: navigation.location,
    pushFeedback,
    showLibraryError,
    showRescanError,
    showRescanSuccess,
    storage,
  });
  const visibleSelectedCount = useMemo(
    () => visibleBooks.reduce((count, book) => count + Number(selectedBookIds.has(book.id)), 0),
    [selectedBookIds, visibleBooks],
  );
  const bulkActions = useLibraryBulkActions({
    books,
    dialogs: dialogActions,
    dismissFeedback,
    leaveSelectionMode,
    pushFeedback,
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
  const quickActionCommands = useMemo<QuickActionCommand[]>(
    () => [
      {
        execute: openBookSearch,
        group: "Library",
        id: "library.search",
        keywords: ["find books", "search library"],
        label: "Search books",
        order: 40,
      },
      {
        execute: () => changeLocation({ type: "library" }),
        group: "Navigate",
        id: "navigate.library",
        keywords: ["go to collection", "home"],
        label: "Go to Library",
        order: 50,
      },
      {
        execute: () => changeLocation({ type: "continue" }),
        group: "Navigate",
        id: "navigate.continue",
        keywords: ["in progress", "continue reading"],
        label: "Go to Continue",
        order: 51,
      },
      {
        execute: () => changeLocation({ type: "favorites" }),
        group: "Navigate",
        id: "navigate.favorites",
        keywords: ["favorite books", "starred"],
        label: "Go to Favorites",
        order: 52,
      },
      {
        execute: () => changeLocation({ type: "folders" }),
        group: "Navigate",
        id: "navigate.folders",
        keywords: ["browse folders", "organization"],
        label: "Go to Folders",
        order: 53,
      },
      {
        execute: () => changeLocation({ type: "series" }),
        group: "Navigate",
        id: "navigate.series",
        keywords: ["browse series", "collections"],
        label: "Go to Series",
        order: 54,
      },
      {
        disabledReason: bookActions.isImporting
          ? "Wait for the current EPUB import to finish."
          : undefined,
        execute: () => dialogActions.openAddEpub(),
        group: "Library",
        id: "library.add-epubs",
        keywords: ["import books", "add files"],
        label: "Add EPUBs",
        order: 60,
      },
      {
        execute: dialogActions.openCreateFolder,
        group: "Library",
        id: "library.create-folder",
        keywords: ["new folder", "organize books"],
        label: "Create folder",
        order: 61,
      },
      {
        disabledReason: bookActions.isImporting
          ? "Wait for the current EPUB import to finish."
          : undefined,
        execute: dialogActions.openRescan,
        group: "Library",
        id: "library.rescan",
        keywords: ["refresh archive", "scan files"],
        label: "Rescan archive",
        order: 62,
      },
    ],
    [bookActions.isImporting, changeLocation, dialogActions, openBookSearch],
  );
  useRegisterQuickActions("library", quickActionCommands);

  const emptyState = locationEmptyState(navigation.location, libraryTitle);
  const currentImportDropDestination = currentFolder?.relativePath ?? ARCHIVE_ROOT_DESTINATION;

  return (
    <>
      <LibraryWorkspaceSurface
        books={books}
        bookCollectionProps={{
          canManageFile: true,
          onDelete: bookActions.requestDeleteBook,
          onMove: dialogActions.openMoveBook,
          onRead: readBook,
          onRenameFile: dialogActions.openRenameBook,
          onRevealFile: bookActions.revealBookFile,
          onSelect: dialogActions.openBookDetails,
          onSelectionChange: changeBookSelection,
          onToggleFavorite: bookActions.toggleFavorite,
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
          onDelete: bookActions.requestDeleteFolder,
          onMove: dialogActions.openMoveFolder,
          onOpen: (folder) => changeLocation({ type: "folder", folderId: folder.id }),
          onRename: dialogActions.openRenameFolder,
          onReveal: (folder) => void bookActions.revealFolder(folder),
          onViewChange: navigation.changeFolderBrowserView,
          view: navigation.folderBrowserView,
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
          onBack: () => changeLocation({ type: "series" }),
          onRead: readBook,
        }}
        seriesOverviewProps={{
          entries: seriesEntries,
          isLoading: books === undefined,
          onClearSearch: () => navigation.setSeriesQuery(""),
          onOpen: (entry) => changeLocation({ type: "series-detail", seriesKey: entry.key }),
          onQueryChange: navigation.setSeriesQuery,
          onRead: readBook,
          query: navigation.seriesQuery,
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
          onDeleteFolder: bookActions.requestDeleteFolder,
          onLocationChange: navigation.changeLocation,
          onManageArchives: openArchiveManager,
          onMoveFolder: dialogActions.openMoveFolder,
          onOpenAbout: dialogActions.openAbout,
          onOpenSettings: openSettings,
          onPreloadAbout: preloadAboutDialog,
          onPreloadSettings: preloadSettings,
          onRenameFolder: dialogActions.openRenameFolder,
          onRevealFolder: (folder) => void bookActions.revealFolder(folder),
          onSwitchArchive: (knownArchive) => void navigation.switchArchive(knownArchive.id),
          seriesCount,
          smartViewCounts,
        }}
        toolbarProps={{
          filterOptions,
          filters,
          isImporting: bookActions.isImporting,
          onClearFilters: clearFilters,
          onClearSearch: navigation.clearLibrarySearch,
          onFilterChange: changeFilters,
          onOpenAddEpub: () => dialogActions.openAddEpub(),
          onQueryChange: navigation.setQuery,
          onRescanError: showRescanError,
          onRescanSuccess: showRescanSuccess,
          onSortChange: changeSort,
          onToggleSelectionMode: toggleSelectionMode,
          onViewChange: changeView,
          query: navigation.query,
          resultCount: visibleBooks.length,
          searchInputRef: navigation.searchInputRef,
          selectionMode,
          sort: effectiveSort,
          title: libraryTitle,
          view,
        }}
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
