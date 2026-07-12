import { CaretRight, MagnifyingGlass, Play, Stack, X } from "@phosphor-icons/react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import type { Book } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { BookCover } from "../library/BookCover";
import { filterSeriesEntries, seriesContinueBook } from "./seriesDerivation";
import { seriesProgressLabel, volumeCountLabel } from "./seriesDisplay";

type SeriesOverviewProps = {
  entries: readonly SeriesEntry[];
  isLoading: boolean;
  onClearSearch: () => void;
  onOpen: (entry: SeriesEntry) => void;
  onQueryChange: (query: string) => void;
  onRead: (book: Book) => void;
  query: string;
};

export function SeriesOverview({
  entries,
  isLoading,
  onClearSearch,
  onOpen,
  onQueryChange,
  onRead,
  query,
}: SeriesOverviewProps) {
  const visibleEntries = filterSeriesEntries(entries, query);

  return (
    <section aria-labelledby="series-overview-title" className="series-overview">
      <header className="series-header">
        <div className="library-header__title">
          <p className="eyebrow">Your collection</p>
          <h1 id="series-overview-title">Series</h1>
        </div>
        <div className="series-search">
          <Input
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            icon={<MagnifyingGlass aria-hidden="true" size={18} />}
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
              <X aria-hidden="true" size={14} weight="bold" />
            </IconButton>
          ) : null}
        </div>
      </header>

      <div className="series-overview__rule">
        <span>{isLoading ? "Loading series" : `${visibleEntries.length} series`}</span>
      </div>

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
        <div className="series-grid">
          {visibleEntries.map((entry) => {
            const representative = entry.books[0];
            const continueBook = seriesContinueBook(entry);

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
                {continueBook ? (
                  <button
                    className="series-card__continue"
                    data-reader-book-id={continueBook.id}
                    disabled={Boolean(continueBook.isFileMissing)}
                    onClick={() => onRead(continueBook)}
                    type="button"
                  >
                    <Play aria-hidden="true" size={13} weight="fill" />
                    <span>Continue</span>
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
