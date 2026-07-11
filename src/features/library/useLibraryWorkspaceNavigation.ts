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
import type { FolderBrowserView, LibraryLocation } from "../../types/library";
import { scrollElementToTop } from "../../utils/motion";
import { requestsBookSearch } from "../quick-actions/quickActions";
import {
  folderBrowserViewFromSearchParams,
  libraryLocationFromSearchParams,
  searchParamsForFolderBrowserView,
  searchParamsForLibraryLocation,
} from "./libraryViewState";

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
};

export function useLibraryWorkspaceNavigation({
  activeArchiveId,
  folders,
  beforeArchiveSwitch,
}: UseLibraryWorkspaceNavigationInput) {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const restoreContext = useMemo(
    () => libraryRestoreContextFromState(routerLocation.state, activeArchiveId),
    [activeArchiveId, routerLocation.state],
  );
  const pageShellRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const returnContextRestoredRef = useRef(false);
  const [query, setQuery] = useState(() => restoreContext?.query ?? "");
  const [seriesQuery, setSeriesQuery] = useState(() => restoreContext?.seriesQuery ?? "");
  const [searchFocusRequest, setSearchFocusRequest] = useState(() =>
    requestsBookSearch(routerLocation.state) ? 1 : 0,
  );

  const location = useMemo(
    () => libraryLocationFromSearchParams(searchParams, folders ?? [], activeArchiveId),
    [activeArchiveId, folders, searchParams],
  );
  const folderBrowserView = useMemo(
    () => folderBrowserViewFromSearchParams(searchParams),
    [searchParams],
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
      );
      if (nextParams.toString() !== searchParams.toString()) {
        setSearchParams(nextParams);
      }
    },
    [activeArchiveId, folders, location, scrollMainContentToTop, searchParams, setSearchParams],
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
    changeFolderBrowserView,
    changeLocation,
    clearLibrarySearch,
    folderBrowserView,
    location,
    openBookSearch,
    openReader,
    pageShellRef,
    query,
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
};

export function useLibraryWorkspaceNavigationLifecycle({
  activeSeriesExists,
  booksReady,
  location,
  changeLocation,
  pageShellRef,
  restoreContext,
  returnContextRestoredRef,
}: UseLibraryWorkspaceNavigationLifecycleInput) {
  useEffect(() => {
    if (booksReady && location.type === "series-detail" && !activeSeriesExists) {
      changeLocation({ type: "series" });
    }
  }, [activeSeriesExists, booksReady, changeLocation, location.type]);

  useEffect(() => {
    if (
      returnContextRestoredRef.current ||
      !restoreContext ||
      !booksReady ||
      (location.type === "series-detail" && !activeSeriesExists)
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const main = pageShellRef.current;
      if (!main) return;
      returnContextRestoredRef.current = true;
      main.scrollTop = restoreContext.scrollTop ?? 0;

      const target = restoreContext.focusBookId
        ? [...main.querySelectorAll<HTMLElement>("[data-reader-book-id]")].find(
            (element) => element.dataset.readerBookId === restoreContext.focusBookId,
          )
        : undefined;
      const focusTarget =
        target instanceof HTMLButtonElement
          ? target
          : target?.querySelector<HTMLElement>("button, [tabindex]");
      (focusTarget ?? main).focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    activeSeriesExists,
    booksReady,
    location.type,
    pageShellRef,
    restoreContext,
    returnContextRestoredRef,
  ]);
}
