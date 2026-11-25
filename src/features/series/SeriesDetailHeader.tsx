import { ArrowLeft, Play } from "lucide-react";
import { Button } from "../../components/Button";
import type { ReadonlyBook } from "../../types/book";
import type { SeriesEntry } from "../../types/series";
import { seriesContinueBook } from "./seriesDerivation";
import { seriesProgressLabel, volumeCountLabel } from "./seriesDisplay";

export function SeriesDetailHeader({
  entry,
  onBack,
  onRead,
}: {
  entry: SeriesEntry;
  onBack: () => void;
  onRead: (book: ReadonlyBook) => void;
}) {
  const continueBook = seriesContinueBook(entry);
  return (
    <>
      <button
        className="series-detail__back inline-flex w-fit justify-self-start min-h-series-back-height items-center gap-series-back-gap rounded-control border-none bg-transparent px-series-back-inset py-0 text-muted text-meta leading-inherit cursor-pointer hover:bg-surface-raised hover:text-text-strong focus-visible:bg-surface-raised focus-visible:text-text-strong"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        <span>All series</span>
      </button>
      <header className="series-detail__header flex items-end justify-between gap-series-header-gap border-b-line pb-collection-header-gap series-stacked:flex-col series-stacked:items-start">
        <div>
          <p className="eyebrow">Series</p>
          <h1
            id="series-detail-title"
            className="m-0 mt-series-title-top max-w-series-title font-app-display text-display-compact text-text-strong wrap-anywhere"
          >
            {entry.displayName}
          </h1>
          <p className="series-detail__summary m-0 mt-series-summary-top text-muted text-meta leading-inherit">
            {volumeCountLabel(entry.books.length)} · {seriesProgressLabel(entry)}
          </p>
        </div>
        <div className="series-detail__actions flex flex-none gap-control-gap series-narrow:grid series-narrow:w-full">
          {continueBook ? (
            <Button
              className="series-narrow:w-full [&:not(:disabled):not([aria-disabled=true])]:cursor-pointer"
              data-reader-book-id={continueBook.id}
              disabled={Boolean(continueBook.isFileMissing)}
              disabledReason={continueBook.isFileMissing ? "The EPUB file is missing." : undefined}
              icon={<Play aria-hidden="true" />}
              onClick={() => onRead(continueBook)}
              size="standard"
            >
              Continue Series
            </Button>
          ) : null}
        </div>
      </header>
    </>
  );
}
