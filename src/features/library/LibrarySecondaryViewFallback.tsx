import { Button } from "../../components/Button";
import type { ComponentProps, ReactNode } from "react";
import { SeriesDetailHeader } from "../series/SeriesDetailHeader";
import type { SeriesEntry } from "../../types/series";
import type { ReadonlyBook } from "../../types/book";
import { SeriesOverviewHeader } from "../series/SeriesOverviewHeader";
import { LibraryIntegrityHeader } from "./LibraryIntegrityHeader";

export function LibrarySecondaryViewFallback({
  header,
  onRetry,
}: {
  header: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <>
      {header}
      <div
        className="collection-content library-content"
        aria-busy={!onRetry || undefined}
        data-surface-state={onRetry ? "error" : "loading"}
      >
        {onRetry ? (
          <>
            <p role="alert">This view could not be opened.</p>
            <Button onClick={onRetry} variant="secondary">
              Try again
            </Button>
          </>
        ) : (
          <p role="status">Opening view…</p>
        )}
      </div>
    </>
  );
}

export function SeriesDetailFallback({
  entry,
  onBack,
  onRead,
  onRetry,
}: {
  entry?: SeriesEntry;
  onBack: () => void;
  onRead: (book: ReadonlyBook) => void;
  onRetry?: () => void;
}) {
  return (
    <section className="series-detail" aria-labelledby={entry ? "series-detail-title" : undefined}>
      <LibrarySecondaryViewFallback
        header={
          entry ? (
            <SeriesDetailHeader entry={entry} onBack={onBack} onRead={onRead} />
          ) : (
            <Button onClick={onBack} variant="secondary">
              Back to Series
            </Button>
          )
        }
        onRetry={onRetry}
      />
    </section>
  );
}

export function SeriesOverviewFallback({
  onRetry,
  ...props
}: ComponentProps<typeof SeriesOverviewHeader> & { onRetry?: () => void }) {
  return (
    <section className="series-overview" aria-labelledby="series-overview-title">
      <LibrarySecondaryViewFallback
        header={<SeriesOverviewHeader {...props} pending />}
        onRetry={onRetry}
      />
    </section>
  );
}

export function IntegrityViewFallback({
  onRetry,
  ...props
}: ComponentProps<typeof LibraryIntegrityHeader> & { onRetry?: () => void }) {
  return (
    <section className={`${props.kind}-view`} aria-labelledby={`${props.kind}-title`}>
      <LibrarySecondaryViewFallback
        header={<LibraryIntegrityHeader {...props} pending />}
        onRetry={onRetry}
      />
    </section>
  );
}
