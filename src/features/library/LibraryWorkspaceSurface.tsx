import { BookOpenText, Copy, FileWarning } from "lucide-react";
import {
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageShell } from "../../components/PageShell";
import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import {
  isLibraryIntegrityLocation,
  libraryIntegrityLocationLabel,
  type CollectionCardSize,
  type LibraryIntegrityLocation,
  type LibraryLocation,
  type LibraryView,
} from "../../types/library";
import { FolderBrowser } from "../folders/FolderBrowser";
import { ariaKeyShortcut, commandDefinitions } from "../commands/commandBindings";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import type { QuickActionRegistration } from "../quick-actions/quickActions";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import { ContinueReading } from "./ContinueReading";
import { LibraryFeedbackStack } from "./LibraryFeedbackStack";
import { LibrarySelectionBar } from "./LibrarySelectionBar";
import { LibrarySidebar } from "./LibrarySidebar";
import {
  LibraryTitlebarComposition,
  type LibraryTitlebarCompositionHandle,
} from "./LibraryTitlebarComposition";
import { LibraryToolbar } from "./LibraryToolbar";
import type { LibraryIntegrityController } from "./useLibraryIntegrity";
import { LibraryDuplicatesView, SeriesDetail, SeriesOverview } from "./libraryLazySurfaces";
import { useBookCollectionFocusPreservation } from "./useBookCollectionFocusPreservation";
import { librarySidebarToggleLabel, useLibrarySidebarState } from "./useLibrarySidebarState";
import { libraryLocationKey } from "./useLibraryWorkspaceNavigation";
import type { LibraryReturnFocusRequest } from "./useLibraryWorkspaceNavigation";

type LibrarySurfaceState = "empty" | "filter-empty" | "loading" | "results" | "search-empty";

function getLibrarySurfaceState(
  books: readonly LibrarySnapshotBook[] | undefined,
  debouncedQuery: string,
  hasFilters: boolean,
  isImporting: boolean,
  isLoading: boolean,
  visibleBooks: readonly LibrarySnapshotBook[],
): LibrarySurfaceState {
  if (books === undefined || ((isLoading || isImporting) && books.length === 0)) return "loading";
  if (visibleBooks.length > 0) return "results";
  if (debouncedQuery) return "search-empty";
  return hasFilters ? "filter-empty" : "empty";
}

type SharedBookCollectionProps = Omit<
  ComponentProps<typeof BookGrid>,
  "books" | "cardSize" | "returnFocusRequest" | "selectedBookIds" | "selectionMode"
> & {
  selectedBookIds: ReadonlySet<string>;
  selectionMode: boolean;
};

type LibraryWorkspaceSurfaceProps = {
  bookCardSize: CollectionCardSize;
  bookFocusFallbackRef: RefObject<HTMLElement | null>;
  books: readonly LibrarySnapshotBook[] | undefined;
  bookCollectionProps: SharedBookCollectionProps;
  continuePreview: readonly LibrarySnapshotBook[];
  debouncedQuery: string;
  duplicatesViewProps: ComponentProps<typeof LibraryDuplicatesView>;
  emptyState: { title: string; description: string };
  feedbackProps: ComponentProps<typeof LibraryFeedbackStack>;
  folderBrowserProps: ComponentProps<typeof FolderBrowser>;
  hasFilters: boolean;
  importDropTarget: NonNullable<ComponentProps<typeof PageShell>["importDropTarget"]>;
  integrity: LibraryIntegrityController;
  isImporting: boolean;
  isLoading: boolean;
  location: LibraryLocation;
  mainRef: RefObject<HTMLElement | null>;
  focusOwnershipKey: string;
  onMountedReturnSurfaceReady: (surfaceKey: string) => void;
  returnFocusRequest: LibraryReturnFocusRequest | null;
  onClearFilters: () => void;
  onClearLibrarySearch: () => void;
  selectionBarProps: ComponentProps<typeof LibrarySelectionBar> | null;
  seriesDetailProps: ComponentProps<typeof SeriesDetail>;
  seriesOverviewProps: ComponentProps<typeof SeriesOverview>;
  showContinueReading: boolean;
  sidebarProps: Omit<ComponentProps<typeof LibrarySidebar>, "collapsed" | "expandedContentRef">;
  titlebarCompositionProps: Omit<
    ComponentProps<typeof LibraryTitlebarComposition>,
    "collapseAvailable" | "collapsed" | "expandedSidebarContentRef" | "onCollapsedChange"
  >;
  toolbarProps: ComponentProps<typeof LibraryToolbar>;
  view: LibraryView;
  visibleBooks: readonly LibrarySnapshotBook[];
};

export function LibraryWorkspaceSurface({
  bookCardSize,
  bookFocusFallbackRef,
  books,
  bookCollectionProps,
  continuePreview,
  debouncedQuery,
  duplicatesViewProps,
  emptyState,
  feedbackProps,
  folderBrowserProps,
  hasFilters,
  importDropTarget,
  integrity,
  isImporting,
  isLoading,
  location,
  mainRef,
  focusOwnershipKey,
  onMountedReturnSurfaceReady,
  returnFocusRequest,
  onClearFilters,
  onClearLibrarySearch,
  selectionBarProps,
  seriesDetailProps,
  seriesOverviewProps,
  showContinueReading,
  sidebarProps,
  titlebarCompositionProps,
  toolbarProps,
  view,
  visibleBooks,
}: LibraryWorkspaceSurfaceProps) {
  const sidebarState = useLibrarySidebarState();
  const expandedSidebarContentRef = useRef<HTMLDivElement>(null);
  const titlebarCompositionRef = useRef<LibraryTitlebarCompositionHandle>(null);
  const { getCommandBinding } = useQuickActions();
  const sidebarCommandScope = location.type === "folders" ? "folders" : "library";
  const sidebarToggleCommand = useMemo<QuickActionRegistration>(
    () => ({
      ...commandDefinitions.toggleSidebar,
      availability: sidebarState.collapseAvailable
        ? { available: true }
        : {
            available: false,
            reason: "Sidebar collapse is unavailable in the constrained navigation layout.",
          },
      execute: () => titlebarCompositionRef.current?.toggleSidebar(),
      label: librarySidebarToggleLabel(sidebarState.collapsed),
      scope: sidebarCommandScope,
    }),
    [sidebarCommandScope, sidebarState.collapseAvailable, sidebarState.collapsed],
  );
  useRegisterQuickActions("library-sidebar", [sidebarToggleCommand]);
  const surfaceState = getLibrarySurfaceState(
    books,
    debouncedQuery,
    hasFilters,
    isImporting,
    isLoading,
    visibleBooks,
  );
  const surfaceKey = `${libraryLocationKey(location)}:${view}:${surfaceState}`;
  const bookCollectionRootRef = useRef<HTMLDivElement>(null);
  const bookSurfaceActive =
    !isLibraryIntegrityLocation(location) &&
    location.type !== "folders" &&
    location.type !== "series" &&
    location.type !== "series-detail";
  const bookFocusRevision = useMemo(
    () => `${surfaceKey}:${bookCardSize}:${visibleBooks.map((book) => book.id).join("\u001f")}`,
    [bookCardSize, surfaceKey, visibleBooks],
  );
  const preservedBookFocusRequest = useBookCollectionFocusPreservation({
    active: bookSurfaceActive,
    books: visibleBooks,
    collectionRootRef: bookCollectionRootRef,
    fallbackRef: bookFocusFallbackRef,
    ownerKey: focusOwnershipKey,
    revision: bookFocusRevision,
    suspended: Boolean(returnFocusRequest),
  });
  const effectiveReturnFocusRequest = returnFocusRequest ?? preservedBookFocusRequest;

  return (
    <PageShell
      importDropTarget={importDropTarget}
      mainRef={mainRef}
      sidebar={
        <>
          <LibraryTitlebarComposition
            {...titlebarCompositionProps}
            collapseAvailable={sidebarState.collapseAvailable}
            collapsed={sidebarState.collapsed}
            expandedSidebarContentRef={expandedSidebarContentRef}
            onCollapsedChange={sidebarState.setCollapsed}
            ref={titlebarCompositionRef}
            sidebarToggleAriaKeyShortcuts={ariaKeyShortcut(
              getCommandBinding(commandDefinitions.toggleSidebar.id),
            )}
          />
          <LibrarySidebar
            {...sidebarProps}
            collapsed={sidebarState.collapsed}
            expandedContentRef={expandedSidebarContentRef}
          />
        </>
      }
      sidebarCollapsed={sidebarState.collapsed}
    >
      {selectionBarProps ? <LibrarySelectionBar {...selectionBarProps} /> : null}
      {location.type === "folders" ? (
        <FolderBrowser {...folderBrowserProps} />
      ) : location.type === "series" ? (
        <Suspense
          fallback={
            <div
              aria-busy="true"
              className="collection-content library-content"
              data-surface-state="loading"
            >
              <div className="collection-content__loading library-loading" role="status">
                Loading series
              </div>
            </div>
          }
        >
          <MountedReaderReturnSurface
            key={libraryLocationKey(location)}
            onReady={onMountedReturnSurfaceReady}
            surfaceKey={libraryLocationKey(location)}
          >
            <SeriesOverview {...seriesOverviewProps} />
          </MountedReaderReturnSurface>
        </Suspense>
      ) : location.type === "series-detail" ? (
        <Suspense
          fallback={
            <div
              aria-busy="true"
              className="collection-content library-content"
              data-surface-state="loading"
            >
              <div className="collection-content__loading library-loading" role="status">
                Loading series
              </div>
            </div>
          }
        >
          <MountedReaderReturnSurface
            key={libraryLocationKey(location)}
            onReady={onMountedReturnSurfaceReady}
            surfaceKey={libraryLocationKey(location)}
          >
            <SeriesDetail {...seriesDetailProps} />
          </MountedReaderReturnSurface>
        </Suspense>
      ) : location.type === "duplicates" ? (
        <Suspense
          fallback={
            <div
              aria-busy="true"
              className="collection-content library-content"
              data-surface-state="loading"
            >
              <div className="collection-content__loading library-loading" role="status">
                Checking for duplicate EPUBs
              </div>
            </div>
          }
        >
          <MountedReaderReturnSurface
            key={libraryLocationKey(location)}
            onReady={onMountedReturnSurfaceReady}
            ready={
              duplicatesViewProps.state.snapshot !== null ||
              duplicatesViewProps.state.status === "error"
            }
            surfaceKey={libraryLocationKey(location)}
          >
            <LibraryDuplicatesView {...duplicatesViewProps} />
          </MountedReaderReturnSurface>
        </Suspense>
      ) : isLibraryIntegrityLocation(location) ? (
        <MountedReaderReturnSurface
          key={libraryLocationKey(location)}
          onReady={onMountedReturnSurfaceReady}
          surfaceKey={libraryLocationKey(location)}
        >
          <LibraryIntegrityPlaceholder integrity={integrity} location={location} />
        </MountedReaderReturnSurface>
      ) : (
        <>
          <LibraryToolbar {...toolbarProps} />
          <div
            aria-busy={surfaceState === "loading" || undefined}
            ref={bookCollectionRootRef}
            className="collection-content library-content"
            data-surface-state={surfaceState}
            key={surfaceKey}
          >
            {location.type === "library" &&
            !toolbarProps.query &&
            !hasFilters &&
            showContinueReading ? (
              <ContinueReading books={continuePreview} onContinue={bookCollectionProps.onRead} />
            ) : null}
            {books === undefined || ((isLoading || isImporting) && books.length === 0) ? (
              <div className="collection-content__loading library-loading" role="status">
                <span className="library-loading__cover" />
                <span>{isImporting ? "Adding EPUB files" : "Loading library"}</span>
              </div>
            ) : visibleBooks.length === 0 && hasFilters && !debouncedQuery ? (
              <EmptyState
                action={
                  <Button variant="secondary" onClick={onClearFilters}>
                    Clear filters
                  </Button>
                }
                description="Remove one or more filters to broaden this view."
                icon={<BookOpenText size={42} strokeWidth={1.5} />}
                title="No matching books"
              />
            ) : visibleBooks.length === 0 && !debouncedQuery ? (
              <EmptyState
                description={emptyState.description}
                icon={<BookOpenText size={42} strokeWidth={1.5} />}
                title={emptyState.title}
              />
            ) : visibleBooks.length === 0 ? (
              <EmptyState
                action={
                  <Button variant="secondary" onClick={onClearLibrarySearch}>
                    Clear search
                  </Button>
                }
                description="Try another title, author, or folder name."
                icon={<BookOpenText size={42} strokeWidth={1.5} />}
                title="No search results"
              />
            ) : view === "grid" ? (
              <BookGrid
                books={visibleBooks}
                cardSize={bookCardSize}
                returnFocusRequest={effectiveReturnFocusRequest}
                {...bookCollectionProps}
              />
            ) : (
              <BookList
                books={visibleBooks}
                returnFocusRequest={effectiveReturnFocusRequest}
                {...bookCollectionProps}
              />
            )}
          </div>
        </>
      )}

      <LibraryFeedbackStack {...feedbackProps} />
    </PageShell>
  );
}

function LibraryIntegrityPlaceholder({
  integrity,
  location,
}: Readonly<{
  integrity: LibraryIntegrityController;
  location: LibraryIntegrityLocation;
}>) {
  const duplicates = location.type === "duplicates";
  const state = duplicates ? integrity.duplicates : integrity.diagnostics;
  const refresh = duplicates ? integrity.refreshDuplicates : integrity.refreshDiagnostics;
  const title = libraryIntegrityLocationLabel(location);
  const Icon = duplicates ? Copy : FileWarning;
  const loading = state.status === "idle" || state.status === "loading";
  const resultCount = duplicates
    ? (integrity.duplicates.snapshot?.groups.length ?? 0)
    : (integrity.diagnostics.snapshot?.entries.length ?? 0);
  const readyDescription = duplicates
    ? resultCount === 1
      ? "1 duplicate group is ready for review."
      : `${resultCount} duplicate groups are ready for review.`
    : resultCount === 1
      ? "1 EPUB file has diagnostic results ready for review."
      : `${resultCount} EPUB files have diagnostic results ready for review.`;

  return (
    <>
      <header className="library-header">
        <div className="library-header__title">
          <p className="eyebrow">Archive integrity</p>
          <h1>{title}</h1>
        </div>
      </header>
      <div
        aria-busy={loading || undefined}
        className="collection-content library-content"
        data-surface-state={loading ? "loading" : state.status}
      >
        {loading ? (
          <div className="collection-content__loading library-loading" role="status">
            <span>{duplicates ? "Checking for duplicate EPUBs" : "Checking EPUB files"}</span>
          </div>
        ) : state.status === "error" ? (
          <div role="alert">
            <EmptyState
              action={
                <Button variant="secondary" onClick={() => void refresh()}>
                  Try again
                </Button>
              }
              description={state.error?.message ?? "Integrity analysis could not be refreshed."}
              icon={<Icon size={42} strokeWidth={1.5} />}
              title={`${title} unavailable`}
            />
          </div>
        ) : (
          <EmptyState
            description={readyDescription}
            icon={<Icon size={42} strokeWidth={1.5} />}
            title="Analysis ready"
          />
        )}
      </div>
    </>
  );
}

function MountedReaderReturnSurface({
  children,
  onReady,
  ready = true,
  surfaceKey,
}: {
  children: ReactNode;
  onReady: (surfaceKey: string) => void;
  ready?: boolean;
  surfaceKey: string;
}) {
  useLayoutEffect(() => {
    if (ready) onReady(surfaceKey);
  }, [onReady, ready, surfaceKey]);
  return children;
}
