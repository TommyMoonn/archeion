import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { canonicalReaderRoute } from "../../app/navigationState";
import {
  createReaderReturnContext,
  libraryRestoreContextFromState,
} from "../../app/readerReturnContext";
import { archiveStore } from "../../stores/archiveStore";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import type { LibraryLocation, LibrarySmartViewPreferences } from "../../types/library";
import { scrollElementToTop } from "../../utils/motion";
import { requestsBookSearch } from "../quick-actions/quickActions";
import {
  hiddenSmartViewFallbackSearchParams,
  libraryLocationFromSearchParams,
  searchParamsForLibraryLocation,
} from "./libraryViewState";
import type { LibraryReturnFocusRequest } from "./useLibraryCollectionWindow";
import { useFolderPathMutationContinuity } from "./useFolderPathMutationContinuity";
export type { LibraryReturnFocusRequest } from "./useLibraryCollectionWindow";

export function libraryLocationKey(location: LibraryLocation): string {
  if (location.type === "folder") return `folder:${location.folderId}`;
  if (location.type === "series-detail") return `series:${location.seriesKey}`;
  if (location.type === "smart-view") return `smart:${location.smartView}`;
  return location.type;
}

type UseLibraryWorkspaceNavigationInput = {
  activeArchiveId: string;
  folders: Folder[] | undefined;
  beforeArchiveSwitch: () => void;
  smartViewPreferences: LibrarySmartViewPreferences;
};

export function useLibraryWorkspaceNavigation({
  activeArchiveId,
  folders,
  beforeArchiveSwitch,
  smartViewPreferences,
}: UseLibraryWorkspaceNavigationInput) {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeRestoreContext = useMemo(
    () => libraryRestoreContextFromState(routerLocation.state, activeArchiveId),
    [activeArchiveId, routerLocation.state],
  );
  const [initialRestoreContext] = useState(routeRestoreContext);
  const restoreContext =
    initialRestoreContext?.archiveId === activeArchiveId
      ? initialRestoreContext
      : routeRestoreContext;
  const pageShellRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const returnContextRestoredRef = useRef(false);
  const [query, setQuery] = useState(() => restoreContext?.query ?? "");
  const [seriesQuery, setSeriesQuery] = useState(() => restoreContext?.seriesQuery ?? "");
  const [searchFocusRequest, setSearchFocusRequest] = useState(() =>
    requestsBookSearch(routerLocation.state) ? 1 : 0,
  );
  const folderPathMutation = useFolderPathMutationContinuity({
    activeArchiveId,
    folders,
    searchParams,
    setSearchParams,
  });

  const location = useMemo(
    () =>
      libraryLocationFromSearchParams(
        searchParams,
        folders ?? [],
        activeArchiveId,
        smartViewPreferences,
        folderPathMutation.pendingMapping,
      ),
    [
      activeArchiveId,
      folderPathMutation.pendingMapping,
      folders,
      searchParams,
      smartViewPreferences,
    ],
  );
  const scrollMainContentToTop = useCallback(() => {
    scrollElementToTop(pageShellRef.current);
  }, []);

  const changeLocation = useCallback(
    (nextLocation: LibraryLocation) => {
      if (libraryLocationKey(location) !== libraryLocationKey(nextLocation)) {
        scrollMainContentToTop();
      }

      const nextParams = searchParamsForLibraryLocation(
        searchParams,
        nextLocation,
        folders ?? [],
        activeArchiveId,
        smartViewPreferences,
      );
      if (nextParams.toString() !== searchParams.toString()) {
        setSearchParams(nextParams);
      }
    },
    [
      activeArchiveId,
      folders,
      location,
      scrollMainContentToTop,
      searchParams,
      setSearchParams,
      smartViewPreferences,
    ],
  );

  const clearLibrarySearch = useCallback(() => {
    setQuery("");
    scrollMainContentToTop();
  }, [scrollMainContentToTop]);

  const openBookSearch = useCallback(() => {
    changeLocation({ type: "library" });
    setSearchFocusRequest((request) => request + 1);
  }, [changeLocation]);

  const openReader = useCallback(
    (book: Book, returnLabel: string, fromBeginning = false) => {
      const readerReturnContext = createReaderReturnContext({
        archiveId: activeArchiveId,
        focusBookId: book.id,
        href: `${routerLocation.pathname}${routerLocation.search}`,
        label: returnLabel,
        query,
        scrollTop: pageShellRef.current?.scrollTop ?? 0,
        seriesQuery,
      });
      const readerRoute = canonicalReaderRoute(book.id);
      void navigate(fromBeginning ? `${readerRoute}?start=beginning` : readerRoute, {
        state: { readerReturnContext },
      });
    },
    [activeArchiveId, navigate, query, routerLocation.pathname, routerLocation.search, seriesQuery],
  );

  const switchArchive = useCallback(
    async (archiveId: string) => {
      beforeArchiveSwitch();
      setSearchParams(
        searchParamsForLibraryLocation(searchParams, { type: "library" }, folders ?? [], archiveId),
        { replace: true },
      );
      await archiveStore.switchArchive(archiveId);
    },
    [beforeArchiveSwitch, folders, searchParams, setSearchParams],
  );

  useEffect(() => {
    const fallbackParams = hiddenSmartViewFallbackSearchParams(
      searchParams,
      smartViewPreferences,
      activeArchiveId,
    );
    if (fallbackParams) {
      setSearchParams(fallbackParams, { replace: true });
    }
  }, [activeArchiveId, searchParams, setSearchParams, smartViewPreferences]);

  useEffect(() => {
    if (searchFocusRequest === 0 || location.type !== "library") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.type, searchFocusRequest]);

  return {
    captureFolderMutationFocus: folderPathMutation.captureFocus,
    changeLocation,
    clearLibrarySearch,
    location,
    openBookSearch,
    openReader,
    pageShellRef,
    query,
    runFolderPathMutation: folderPathMutation.run,
    restoreContext,
    returnContextRestoredRef,
    scrollMainContentToTop,
    searchInputRef,
    seriesQuery,
    setQuery,
    setSeriesQuery,
    switchArchive,
  };
}

type UseLibraryWorkspaceNavigationLifecycleInput = {
  activeSeriesExists: boolean;
  booksReady: boolean;
  location: LibraryLocation;
  changeLocation: (location: LibraryLocation) => void;
  pageShellRef: React.RefObject<HTMLElement | null>;
  restoreContext: ReturnType<typeof libraryRestoreContextFromState>;
  returnContextRestoredRef: React.RefObject<boolean>;
  visibleBooks: readonly Book[];
};

export type LibraryReturnRestoration = Readonly<{
  collectionRequest: LibraryReturnFocusRequest | null;
  onMountedSurfaceReady: (surfaceKey: string) => void;
}>;

const MOUNTED_READER_FOCUS_TARGET_SELECTOR =
  "button, a[href], input, select, textarea, summary, [tabindex]";

export function findMountedReaderBookFocusTarget(
  root: HTMLElement,
  bookId: string,
): HTMLElement | null {
  for (const bookTarget of root.querySelectorAll<HTMLElement>("[data-reader-book-id]")) {
    if (bookTarget.dataset.readerBookId !== bookId) continue;
    if (isUsableReaderFocusTarget(bookTarget)) return bookTarget;
    for (const descendant of bookTarget.querySelectorAll<HTMLElement>(
      MOUNTED_READER_FOCUS_TARGET_SELECTOR,
    )) {
      if (isUsableReaderFocusTarget(descendant)) return descendant;
    }
  }
  return null;
}

export function useLibraryWorkspaceNavigationLifecycle({
  activeSeriesExists,
  booksReady,
  location,
  changeLocation,
  pageShellRef,
  restoreContext,
  returnContextRestoredRef,
  visibleBooks,
}: UseLibraryWorkspaceNavigationLifecycleInput): LibraryReturnRestoration {
  const [pendingBookId, setPendingBookId] = useState<string | null>(null);
  const pendingBookIdRef = useRef<string | null>(null);
  const focusAtRequestRef = useRef<Element | null>(null);
  const readyMountedSurfaceKeyRef = useRef<string | null>(null);
  const restorationRequestedRef = useRef(false);

  const pendingCollectionIndex = pendingBookId
    ? visibleBooks.findIndex((book) => book.id === pendingBookId)
    : -1;

  const completeRestoration = useCallback(
    (target: HTMLElement | null) => {
      if (returnContextRestoredRef.current) return;
      const main = pageShellRef.current;
      const currentFocus = document.activeElement;
      const userMovedFocus =
        currentFocus instanceof HTMLElement &&
        currentFocus !== document.body &&
        currentFocus !== main &&
        currentFocus !== focusAtRequestRef.current;
      if (!userMovedFocus) (target ?? main)?.focus({ preventScroll: true });
      returnContextRestoredRef.current = true;
      pendingBookIdRef.current = null;
      setPendingBookId(null);
    },
    [pageShellRef, returnContextRestoredRef],
  );

  const resolveMountedTarget = useCallback(
    (bookId: string): boolean => {
      const main = pageShellRef.current;
      if (!main) return false;
      const target = findMountedReaderBookFocusTarget(main, bookId);
      if (!target) return false;
      completeRestoration(target);
      return true;
    },
    [completeRestoration, pageShellRef],
  );

  const onMountedSurfaceReady = useCallback(
    (surfaceKey: string) => {
      readyMountedSurfaceKeyRef.current = surfaceKey;
      const bookId = pendingBookIdRef.current;
      if (!bookId || returnContextRestoredRef.current) return;
      if (!resolveMountedTarget(bookId)) completeRestoration(null);
    },
    [completeRestoration, resolveMountedTarget, returnContextRestoredRef],
  );

  const completeCollectionTargetRestoration = useCallback(
    (bookId: string, index: number, target: HTMLElement) => {
      const bookTarget = target.closest<HTMLElement>("[data-library-index]");
      if (
        returnContextRestoredRef.current ||
        pendingBookIdRef.current !== bookId ||
        pendingBookId !== bookId ||
        pendingCollectionIndex !== index ||
        !target.isConnected ||
        bookTarget?.dataset.readerBookId !== bookId ||
        Number(bookTarget.dataset.libraryIndex) !== index
      ) {
        return;
      }
      const main = pageShellRef.current;
      const preferredTarget = main ? findMountedReaderBookFocusTarget(main, bookId) : null;
      completeRestoration(preferredTarget ?? target);
    },
    [
      completeRestoration,
      pageShellRef,
      pendingBookId,
      pendingCollectionIndex,
      returnContextRestoredRef,
    ],
  );

  useEffect(() => {
    if (booksReady && location.type === "series-detail" && !activeSeriesExists) {
      changeLocation({ type: "series" });
    }
  }, [activeSeriesExists, booksReady, changeLocation, location.type]);

  useEffect(() => {
    if (
      returnContextRestoredRef.current ||
      restorationRequestedRef.current ||
      !restoreContext ||
      !booksReady ||
      (location.type === "series-detail" && !activeSeriesExists)
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const main = pageShellRef.current;
      if (!main) return;
      restorationRequestedRef.current = true;
      focusAtRequestRef.current = document.activeElement;
      main.scrollTop = restoreContext.scrollTop ?? 0;
      const bookId = restoreContext.focusBookId;
      if (!bookId) {
        completeRestoration(null);
        return;
      }

      if (resolveMountedTarget(bookId)) return;

      pendingBookIdRef.current = bookId;
      setPendingBookId(bookId);
      if (locationUsesBookCollection(location)) {
        if (!visibleBooks.some((book) => book.id === bookId)) completeRestoration(null);
        return;
      }
      if (
        locationUsesMountedReaderSurface(location) &&
        readyMountedSurfaceKeyRef.current !== libraryLocationKey(location)
      ) {
        return;
      }
      completeRestoration(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    activeSeriesExists,
    booksReady,
    location,
    pageShellRef,
    restoreContext,
    returnContextRestoredRef,
    completeRestoration,
    resolveMountedTarget,
    visibleBooks,
  ]);

  useEffect(() => {
    if (!pendingBookId || returnContextRestoredRef.current) return;
    if (resolveMountedTarget(pendingBookId)) return;
    if (locationUsesBookCollection(location)) {
      if (pendingCollectionIndex < 0) completeRestoration(null);
      return;
    }
    if (
      !locationUsesMountedReaderSurface(location) ||
      readyMountedSurfaceKeyRef.current === libraryLocationKey(location)
    ) {
      completeRestoration(null);
    }
  }, [
    completeRestoration,
    location,
    pendingBookId,
    pendingCollectionIndex,
    resolveMountedTarget,
    returnContextRestoredRef,
  ]);

  return {
    collectionRequest:
      pendingBookId && locationUsesBookCollection(location) && pendingCollectionIndex >= 0
        ? {
            bookId: pendingBookId,
            index: pendingCollectionIndex,
            onTargetReady: completeCollectionTargetRestoration,
          }
        : null,
    onMountedSurfaceReady,
  };
}

function locationUsesBookCollection(location: LibraryLocation): boolean {
  return !["folders", "series", "series-detail"].includes(location.type);
}

function locationUsesMountedReaderSurface(location: LibraryLocation): boolean {
  return location.type === "series" || location.type === "series-detail";
}

function isUsableReaderFocusTarget(target: HTMLElement): boolean {
  if (!target.matches(MOUNTED_READER_FOCUS_TARGET_SELECTOR)) return false;
  if (target.matches(":disabled, [aria-disabled='true']")) return false;
  return target.getAttribute("tabindex") !== "-1";
}
