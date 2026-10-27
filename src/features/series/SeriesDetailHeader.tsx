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
      {" "}
      <button className="series-detail__back" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={16} />
        <span>All series</span>
      </button>
      <header className="series-detail__header">
        <div>
          <p className="eyebrow">Series</p>
          <h1 id="series-detail-title">{entry.displayName}</h1>
          <p className="series-detail__summary">
            {volumeCountLabel(entry.books.length)} · {seriesProgressLabel(entry)}
          </p>
        </div>
        <div className="series-detail__actions">
          {continueBook ? (
            <Button
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
