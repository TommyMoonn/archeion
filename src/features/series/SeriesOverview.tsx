import { ChevronRight, Layers } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, type Ref } from "react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { focusElementIfRestorationOwned, focusIsUnowned } from "../../utils/focusRestoration";
import type { CollectionCardSize, LibraryView, SeriesSort } from "../../types/library";
import type { SeriesEntry } from "../../types/series";
import { BookCover } from "../library/BookCover";
import { seriesProgressLabel, volumeCountLabel } from "./seriesDisplay";
import { deriveSeriesOverviewEntries } from "./seriesOverviewReadModel";
import { SeriesOverviewHeader } from "./SeriesOverviewHeader";

type SeriesOverviewProps = {
  cardSize: CollectionCardSize;
  entries: readonly SeriesEntry[];
  isLoading: boolean;
  onClearSearch: () => void;
  onOpen: (entry: SeriesEntry) => void;
  onQueryChange: (query: string) => void;
  onReturnFocusComplete?: () => void;
  onSortChange: (sort: SeriesSort) => void;
  onViewChange: (view: LibraryView) => void;
  query: string;
  returnFocusKey?: string | null;
  sort: SeriesSort;
  view: LibraryView;
  searchAriaKeyShortcuts?: string;
  searchInputRef?: Ref<HTMLInputElement>;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

const SeriesOverviewCard = memo(function SeriesOverviewCard({
  entry,
  onOpen,
}: {
  entry: SeriesEntry;
  onOpen: (entry: SeriesEntry) => void;
}) {
  const representative = entry.books[0];
  if (!representative) return null;

  return (
    <article className="series-card">
      <button
        aria-label={`Open ${entry.displayName}`}
        className="series-card__open"
        data-library-series-key={entry.key}
        onClick={() => onOpen(entry)}
        type="button"
      >
        <BookCover book={representative} className="book-cover--series" />
        <span className="series-card__copy">
          <strong>{entry.displayName}</strong>
          <span>{volumeCountLabel(entry.books.length)}</span>
          <span className="series-card__status">{seriesProgressLabel(entry)}</span>
        </span>
        <ChevronRight aria-hidden="true" size={17} />
      </button>
    </article>
  );
});

export const SeriesOverview = memo(function SeriesOverview({
  cardSize,
  entries,
  isLoading,
  onClearSearch,
  onOpen,
  onQueryChange,
  onReturnFocusComplete,
  onSortChange,
  onViewChange,
  query,
  returnFocusKey,
  sort,
  view,
  searchAriaKeyShortcuts,
  searchInputRef,
}: SeriesOverviewProps) {
  const visibleEntries = useMemo(
    () => deriveSeriesOverviewEntries(entries, query, sort),
    [entries, query, sort],
  );
  const surfaceState =
    visibleEntries.length > 0
      ? "results"
      : entries.length > 0
        ? "search-empty"
        : isLoading
          ? "loading"
          : "empty";
  const overviewRef = useRef<HTMLElement>(null);
  const seriesSearchRef = useRef<HTMLInputElement>(null);
  const completedReturnFocusKeyRef = useRef<string | null>(null);
  const setSeriesSearchRef = useCallback(
    (element: HTMLInputElement | null) => {
      seriesSearchRef.current = element;
      assignRef(searchInputRef, element);
    },
    [searchInputRef],
  );

  useLayoutEffect(() => {
    if (!returnFocusKey) {
      completedReturnFocusKeyRef.current = null;
      return;
    }
    if (surfaceState === "loading" || completedReturnFocusKeyRef.current === returnFocusKey) return;

    const target = Array.from(
      overviewRef.current?.querySelectorAll<HTMLButtonElement>("[data-library-series-key]") ?? [],
    ).find((candidate) => candidate.dataset.librarySeriesKey === returnFocusKey);
    const routeEntry = overviewRef.current?.closest("main") ?? null;
    if (target) {
      if (focusIsUnowned() || document.activeElement === routeEntry) {
        focusElementIfRestorationOwned(target, { invalidatedOrigin: routeEntry });
      }
    } else if (focusIsUnowned() || document.activeElement === routeEntry) {
      focusElementIfRestorationOwned(seriesSearchRef.current, {
        invalidatedOrigin: routeEntry,
      });
    }

    completedReturnFocusKeyRef.current = returnFocusKey;
    onReturnFocusComplete?.();
  }, [onReturnFocusComplete, returnFocusKey, surfaceState, visibleEntries]);

  return (
    <section ref={overviewRef} aria-labelledby="series-overview-title" className="series-overview">
      <SeriesOverviewHeader
        {...{
          onQueryChange,
          onClearSearch,
          onSortChange,
          onViewChange,
          query,
          sort,
          view,
          searchAriaKeyShortcuts,
        }}
        searchInputRef={setSeriesSearchRef}
        resultLabel={
          surfaceState === "loading" ? "Loading series" : `${visibleEntries.length} series`
        }
      />

      <div
        aria-busy={surfaceState === "loading" || undefined}
        className="collection-content series-overview__content"
        data-surface-state={surfaceState}
      >
        {surfaceState === "loading" ? (
          <div aria-label="Loading series" className="series-loading" role="status">
            <span />
            <span />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            description="Add series metadata to EPUBs to group their volumes here."
            icon={<Layers size={42} strokeWidth={1.5} />}
            title="No series metadata"
          />
        ) : visibleEntries.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={onClearSearch} size="standard" variant="secondary">
                Clear search
              </Button>
            }
            description="Try another series name."
            icon={<Layers size={42} strokeWidth={1.5} />}
            title="No matching series"
          />
        ) : (
          <div
            className={`series-grid series-grid--${view} collection-content__items`}
            data-series-card-size={cardSize}
          >
            {visibleEntries.map((entry) => (
              <SeriesOverviewCard entry={entry} key={entry.key} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
});
