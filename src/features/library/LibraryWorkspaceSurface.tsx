import { BookOpenText } from "@phosphor-icons/react";
import {
  Suspense,
  useLayoutEffect,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageShell } from "../../components/PageShell";
import type { Book } from "../../types/book";
import type { CollectionCardSize, LibraryLocation, LibraryView } from "../../types/library";
import { FolderBrowser } from "../folders/FolderBrowser";
import { BookGrid } from "./BookGrid";
import { BookList } from "./BookList";
import { ContinueReading } from "./ContinueReading";
import { LibraryFeedbackStack } from "./LibraryFeedbackStack";
import { LibrarySelectionBar } from "./LibrarySelectionBar";
import { LibrarySidebar } from "./LibrarySidebar";
import { LibraryToolbar } from "./LibraryToolbar";
import { SeriesDetail, SeriesOverview } from "./libraryLazySurfaces";
import { libraryLocationKey } from "./useLibraryWorkspaceNavigation";
import type { LibraryReturnFocusRequest } from "./useLibraryWorkspaceNavigation";

type LibrarySurfaceState = "empty" | "filter-empty" | "loading" | "results" | "search-empty";

function getLibrarySurfaceState(
  books: Book[] | undefined,
  debouncedQuery: string,
  hasFilters: boolean,
  isImporting: boolean,
  visibleBooks: Book[],
): LibrarySurfaceState {
  if (books === undefined || (isImporting && books.length === 0)) return "loading";
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
  books: Book[] | undefined;
  bookCollectionProps: SharedBookCollectionProps;
  continuePreview: Book[];
  debouncedQuery: string;
  emptyState: { title: string; description: string };
  feedbackProps: ComponentProps<typeof LibraryFeedbackStack>;
  folderBrowserProps: ComponentProps<typeof FolderBrowser>;
  hasFilters: boolean;
  importDropTarget: NonNullable<ComponentProps<typeof PageShell>["importDropTarget"]>;
  isImporting: boolean;
  location: LibraryLocation;
  mainRef: RefObject<HTMLElement | null>;
  onMountedReturnSurfaceReady: (surfaceKey: string) => void;
  returnFocusRequest: LibraryReturnFocusRequest | null;
  onClearFilters: () => void;
  onClearLibrarySearch: () => void;
  selectionBarProps: ComponentProps<typeof LibrarySelectionBar> | null;
  seriesDetailProps: ComponentProps<typeof SeriesDetail>;
  seriesOverviewProps: ComponentProps<typeof SeriesOverview>;
  showContinueReading: boolean;
  sidebarProps: ComponentProps<typeof LibrarySidebar>;
  toolbarProps: ComponentProps<typeof LibraryToolbar>;
  view: LibraryView;
  visibleBooks: Book[];
};

export function LibraryWorkspaceSurface({
  bookCardSize,
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
  location,
  mainRef,
  onMountedReturnSurfaceReady,
  returnFocusRequest,
  onClearFilters,
  onClearLibrarySearch,
  selectionBarProps,
  seriesDetailProps,
  seriesOverviewProps,
  showContinueReading,
  sidebarProps,
  toolbarProps,
  view,
  visibleBooks,
}: LibraryWorkspaceSurfaceProps) {
  const surfaceState = getLibrarySurfaceState(
    books,
    debouncedQuery,
    hasFilters,
    isImporting,
    visibleBooks,
  );
  const surfaceKey = `${libraryLocationKey(location)}:${view}:${surfaceState}`;

  return (
    <PageShell
      importDropTarget={importDropTarget}
      mainRef={mainRef}
      sidebar={<LibrarySidebar {...sidebarProps} />}
    >
      {selectionBarProps ? <LibrarySelectionBar {...selectionBarProps} /> : null}
      {location.type === "folders" ? (
        <FolderBrowser {...folderBrowserProps} />
      ) : location.type === "series" ? (
        <Suspense
          fallback={
            <div className="library-loading" role="status">
              Loading series
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
            <div className="library-loading" role="status">
              Loading series
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
            {books === undefined || (isImporting && books.length === 0) ? (
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
                  <Button variant="secondary" onClick={onClearLibrarySearch}>
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
                cardSize={bookCardSize}
                returnFocusRequest={returnFocusRequest}
                {...bookCollectionProps}
              />
            ) : (
              <BookList
                books={visibleBooks}
                returnFocusRequest={returnFocusRequest}
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
