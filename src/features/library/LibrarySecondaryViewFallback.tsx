import { CollectionLoading } from "../../components/CollectionLoading";
import { Button } from "../../components/Button";
import type { ComponentProps, ReactNode } from "react";
import { SeriesDetailHeader } from "../series/SeriesDetailHeader";
import type { SeriesEntry } from "../../types/series";
import type { ReadonlyBook } from "../../types/book";
import { SeriesOverviewHeader } from "../series/SeriesOverviewHeader";
import { LibraryIntegrityHeader } from "./LibraryIntegrityHeader";

export function LibrarySecondaryViewFallback({
  header,
  loadingLabel,
  onRetry,
}: {
  header: ReactNode;
  loadingLabel: string;
  onRetry?: () => void;
}) {
  return (
    <>
      {header}
      <div
        className="collection-content library-content w-full"
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
          <CollectionLoading message={loadingLabel} />
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
    <section
      className="series-detail mx-auto grid w-full max-w-collection-workspace gap-series-detail-gap"
      aria-labelledby={entry ? "series-detail-title" : undefined}
    >
      <LibrarySecondaryViewFallback
        loadingLabel="Loading series details"
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
    <section
      className="series-overview mx-auto w-full max-w-collection-workspace"
      aria-labelledby="series-overview-title"
    >
      <LibrarySecondaryViewFallback
        loadingLabel="Loading series"
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
        loadingLabel={
          props.kind === "duplicates" ? "Checking for duplicate EPUBs" : "Checking EPUB files"
        }
        header={<LibraryIntegrityHeader {...props} pending />}
        onRetry={onRetry}
      />
    </section>
  );
}
