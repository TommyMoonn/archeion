import { CaretRight, GridFour, List, MagnifyingGlass, Stack, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { LibraryView } from "../../types/library";
import type { SeriesEntry } from "../../types/series";
import { BookCover } from "../library/BookCover";
import { filterSeriesEntries } from "./seriesDerivation";
import { seriesProgressLabel, volumeCountLabel } from "./seriesDisplay";

type SeriesOverviewProps = {
  entries: readonly SeriesEntry[];
  isLoading: boolean;
  onClearSearch: () => void;
  onOpen: (entry: SeriesEntry) => void;
  onQueryChange: (query: string) => void;
  query: string;
};

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

export function SeriesOverview({
  entries,
  isLoading,
  onClearSearch,
  onOpen,
  onQueryChange,
  query,
}: SeriesOverviewProps) {
  const [view, setView] = useState<LibraryView>("grid");
  const visibleEntries = filterSeriesEntries(entries, query);

  return (
    <section aria-labelledby="series-overview-title" className="series-overview">
      <header className="library-header series-header">
        <div className="library-header__title">
          <p className="eyebrow">Your collection</p>
          <h1 id="series-overview-title">Series</h1>
        </div>
        <div className="library-header__actions library-header__actions--search-only series-header__actions">
          <div className="series-search">
            <Input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              icon={<MagnifyingGlass aria-hidden="true" />}
              label="Search series"
              name="archeion-series-search"
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder="Search series"
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
            {isLoading ? "Loading series" : `${visibleEntries.length} series`}
          </span>
          <div className="library-controls__display">
            <SegmentedControl
              appearance="icon-only"
              label="Series view"
              onChange={setView}
              options={seriesViewOptions}
              value={view}
            />
          </div>
        </div>
      </header>

      {isLoading ? (
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
        <div className={`series-grid series-grid--${view}`}>
          {visibleEntries.map((entry) => {
            const representative = entry.books[0];

            if (!representative) {
              return null;
            }

            return (
              <article className="series-card" key={entry.key}>
                <button
                  aria-label={`Open ${entry.displayName}`}
                  className="series-card__open"
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
          })}
        </div>
      )}
    </section>
  );
}
