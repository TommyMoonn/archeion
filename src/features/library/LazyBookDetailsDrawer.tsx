import { Suspense } from "react";
import { createAsyncSurface } from "../../components/createAsyncSurface";
import { Skeleton } from "../../components/ui/skeleton";
import { BookDetailsDrawerFrame } from "./BookDetailsDrawerFrame";
import type { BookDetailsDrawerProps } from "./BookDetailsDrawer";
import { bookAuthor, bookTitle } from "./libraryFilters";
import { displayedBookProgress, hasSavedReadingPosition } from "../reading/readingProgress";
import { bookCompletionActionLabel } from "./bookCompletionActionLabel";
import {
  detailsActions,
  detailsAuthor,
  detailsBody,
  detailsCover,
  detailsDescription,
  detailsDescriptionHeading,
  detailsFooter,
  detailsHeading,
  detailsMetadata,
  detailsMetadataLabel,
  detailsMetadataRow,
  detailsMetadataValue,
  detailsMissing,
  detailsMissingActions,
  detailsProgress,
  detailsSecondaryActions,
  detailsTitle,
} from "./bookDetailsStyles";
const DrawerContent = createAsyncSurface<BookDetailsDrawerProps>(() =>
  import("./BookDetailsDrawer").then((module) => ({ default: module.BookDetailsDrawerContent })),
);

export function BookDetailsDrawer(props: BookDetailsDrawerProps) {
  return (
    <BookDetailsDrawerFrame {...props}>
      <BookDetailsContent {...props} />
    </BookDetailsDrawerFrame>
  );
}

export function BookDetailsContent(props: BookDetailsDrawerProps) {
  return (
    <Suspense fallback={<BookDetailsLoadingSkeleton {...props} />}>
      <DrawerContent {...props} />
    </Suspense>
  );
}

type BookDetailsLoadingSkeletonProps = Pick<
  BookDetailsDrawerProps,
  "book" | "canDeleteBook" | "canManageFile" | "canRevealFile"
>;

function DetailsSkeleton({ className }: { className: string }) {
  return (
    <Skeleton
      className={`details-skeleton-sheen motion-safe:app-motion:animate-loading-sheen ${className}`}
    />
  );
}

const actionSkeleton =
  "min-w-0 min-h-control-standard border-standard border-solid border-line-subtle";
const compactActionSkeleton =
  "min-w-0 min-h-control-compact border-standard border-solid border-line-subtle";
const lineSkeleton = "h-details-skeleton-line rounded-pill";

export function BookDetailsLoadingSkeleton({
  book,
  canDeleteBook = true,
  canManageFile = false,
  canRevealFile = false,
}: BookDetailsLoadingSkeletonProps) {
  const title = bookTitle(book);
  const author = bookAuthor(book);
  const progress = displayedBookProgress(book);
  const hasSavedPosition = hasSavedReadingPosition(book);
  const secondaryActionCount = 1 + Number(canRevealFile) + (canManageFile ? 2 : 0);
  const hasDescription = Boolean(book.sourceMetadata?.description?.trim());

  return (
    <>
      <div className="book-details-loading flex min-h-0 flex-1 flex-col" aria-busy="true">
        <div className={detailsBody} aria-hidden="true">
          <div className={detailsCover}>
            <DetailsSkeleton className="w-details-cover aspect-book-cover rounded-menu border-standard border-solid border-line shadow-app-card" />
          </div>

          <div className={detailsTitle}>
            <h2 className={detailsHeading} id="book-details-title">
              {title}
            </h2>
            {author ? <p className={detailsAuthor}>{author}</p> : null}
            {hasSavedPosition || progress > 0 ? (
              <div className={detailsProgress}>
                {progress > 0 ? (
                  <DetailsSkeleton className="w-cover-editor-thumbnail min-h-dialog-panel rounded-pill border-standard border-solid border-line-subtle" />
                ) : null}
                <DetailsSkeleton className="size-dialog-panel" />
              </div>
            ) : null}
          </div>

          {book.isFileMissing ? (
            <section className={detailsMissing}>
              <DetailsSkeleton className="size-feedback-glyph" />
              <div className="grid gap-menu-item-block">
                <DetailsSkeleton className="h-3 w-full max-w-36 rounded-pill" />
                <DetailsSkeleton className={`${lineSkeleton} w-full max-w-52`} />
              </div>
              <div className={detailsMissingActions}>
                <DetailsSkeleton className={compactActionSkeleton} />
                <DetailsSkeleton className={compactActionSkeleton} />
              </div>
            </section>
          ) : (
            <div className={detailsActions}>
              <DetailsSkeleton className={actionSkeleton} />
              {hasSavedPosition ? <DetailsSkeleton className={actionSkeleton} /> : null}
              {bookCompletionActionLabel(book) ? (
                <DetailsSkeleton className={actionSkeleton} />
              ) : null}
              <div className={detailsSecondaryActions}>
                {Array.from({ length: secondaryActionCount }, (_, index) => (
                  <DetailsSkeleton className={compactActionSkeleton} key={index} />
                ))}
              </div>
            </div>
          )}

          {hasDescription ? (
            <section className={detailsDescription}>
              <h3 className={detailsDescriptionHeading}>Description</h3>
              <div className="grid gap-control-gap">
                <DetailsSkeleton className={`${lineSkeleton} w-full`} />
                <DetailsSkeleton className={`${lineSkeleton} w-full`} />
                <DetailsSkeleton className={`${lineSkeleton} w-details-skeleton-short`} />
              </div>
            </section>
          ) : null}

          <dl className={detailsMetadata}>
            <div className={detailsMetadataRow}>
              <dt className={detailsMetadataLabel}>File</dt>
              <dd className={`${detailsMetadataValue} items-end`}>
                <DetailsSkeleton className={`${lineSkeleton} w-full max-w-40`} />
                <DetailsSkeleton className={`${lineSkeleton} w-14`} />
              </dd>
            </div>
            {book.lastOpenedAt ? (
              <div className={detailsMetadataRow}>
                <dt className={detailsMetadataLabel}>Last opened</dt>
                <dd className={`${detailsMetadataValue} items-end`}>
                  <DetailsSkeleton className={`${lineSkeleton} w-full max-w-28`} />
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        {canDeleteBook && !book.isFileMissing ? (
          <footer className={detailsFooter} aria-hidden="true">
            <DetailsSkeleton className={`${actionSkeleton} w-full`} />
          </footer>
        ) : null}
      </div>
      <span className="sr-only" role="status">
        Loading book details
      </span>
    </>
  );
}
