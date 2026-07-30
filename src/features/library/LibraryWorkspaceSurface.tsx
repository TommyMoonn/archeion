import { BookOpenText } from "lucide-react";
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
import type { CollectionCardSize, LibraryLocation, LibraryView } from "../../types/library";
import { FolderBrowser } from "../folders/FolderBrowser";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import { ContinueReading } from "./ContinueReading";
import { LibraryFeedbackStack } from "./LibraryFeedbackStack";
import { LibrarySelectionBar } from "./LibrarySelectionBar";
import { LibrarySidebar } from "./LibrarySidebar";
import { LibraryTitlebarComposition } from "./LibraryTitlebarComposition";
import { LibraryToolbar } from "./LibraryToolbar";
import { SeriesDetail, SeriesOverview } from "./libraryLazySurfaces";
import { useBookCollectionFocusPreservation } from "./useBookCollectionFocusPreservation";
import { useLibrarySidebarState } from "./useLibrarySidebarState";
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
  emptyState: { title: string; description: string };
  feedbackProps: ComponentProps<typeof LibraryFeedbackStack>;
  folderBrowserProps: ComponentProps<typeof FolderBrowser>;
  hasFilters: boolean;
  importDropTarget: NonNullable<ComponentProps<typeof PageShell>["importDropTarget"]>;
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
  emptyState,
  feedbackProps,
  folderBrowserProps,
  hasFilters,
  importDropTarget,
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
    location.type !== "folders" && location.type !== "series" && location.type !== "series-detail";
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

function MountedReaderReturnSurface({
  children,
  onReady,
  surfaceKey,
}: {
  children: ReactNode;
  onReady: (surfaceKey: string) => void;
  surfaceKey: string;
}) {
  useLayoutEffect(() => {
    onReady(surfaceKey);
  }, [onReady, surfaceKey]);
  return children;
}
