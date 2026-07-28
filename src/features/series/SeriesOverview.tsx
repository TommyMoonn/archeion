import { CaretRight, GridFour, List, MagnifyingGlass, Stack, X } from "@phosphor-icons/react";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
} from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import { focusElementIfRestorationOwned, focusIsUnowned } from "../../utils/focusRestoration";
import type { CollectionCardSize, LibraryView, SeriesSort } from "../../types/library";
import type { SeriesEntry } from "../../types/series";
import { BookCover } from "../library/BookCover";
import { seriesProgressLabel, volumeCountLabel } from "./seriesDisplay";
import { deriveSeriesOverviewEntries } from "./seriesOverviewReadModel";
import { seriesSortOptions } from "./seriesSortOptions";

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

const seriesViewOptions: Array<{
  icon: ReactNode;
  label: string;
  value: LibraryView;
}> = [
  {
    icon: <GridFour aria-hidden="true" weight="regular" />,
    label: "Grid",
    value: "grid",
  },
  {
    icon: <List aria-hidden="true" weight="regular" />,
    label: "List",
    value: "list",
  },
];

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
        <CaretRight aria-hidden="true" size={17} weight="bold" />
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
    if (target) {
      if (focusIsUnowned()) focusElementIfRestorationOwned(target);
    } else if (focusIsUnowned()) {
      focusElementIfRestorationOwned(seriesSearchRef.current);
    }

    completedReturnFocusKeyRef.current = returnFocusKey;
    onReturnFocusComplete?.();
  }, [onReturnFocusComplete, returnFocusKey, surfaceState, visibleEntries]);

  return (
    <section ref={overviewRef} aria-labelledby="series-overview-title" className="series-overview">
      <header className="library-header series-header">
        <div className="library-header__title">
          <p className="eyebrow">Your collection</p>
          <h1 id="series-overview-title">Series</h1>
        </div>
        <div className="library-header__actions library-header__actions--search-only series-header__actions">
          <div className="series-search">
            <Input
              aria-keyshortcuts={searchAriaKeyShortcuts}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              icon={<MagnifyingGlass aria-hidden="true" />}
              label="Search series"
              name="archeion-series-search"
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder="Search series"
              ref={setSeriesSearchRef}
              size="standard"
              spellCheck={false}
              type="search"
              value={query}
            />
            {query ? (
              <IconButton
                className="series-search__clear"
                label="Clear series search"
                onClick={onClearSearch}
              >
                <X aria-hidden="true" weight="bold" />
              </IconButton>
            ) : null}
          </div>
        </div>

        <div className="library-controls series-overview__controls">
          <span className="library-result-count" aria-live="polite">
            {surfaceState === "loading" ? "Loading series" : `${visibleEntries.length} series`}
          </span>
          <div className="library-controls__display">
            <AppSelect
              ariaLabel="Sort series"
              className="series-sort-select"
              onChange={onSortChange}
              options={seriesSortOptions}
              value={sort}
            />
            <SegmentedControl
              appearance="icon-only"
              label="Series view"
              onChange={onViewChange}
              options={seriesViewOptions}
              value={view}
            />
          </div>
        </div>
      </header>

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
            icon={<Stack size={42} weight="thin" />}
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
            icon={<Stack size={42} weight="thin" />}
            title="No matching series"
          />
        ) : (
          <div className={`series-grid series-grid--${view}`} data-series-card-size={cardSize}>
            {visibleEntries.map((entry) => (
              <SeriesOverviewCard entry={entry} key={entry.key} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
});
