import { Suspense } from "react";
import { createAsyncSurface } from "../../components/createAsyncSurface";
import { BookDetailsDrawerFrame } from "./BookDetailsDrawerFrame";
import type { BookDetailsDrawerProps } from "./BookDetailsDrawer";
import { bookAuthor, bookTitle } from "./libraryFilters";
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

export function BookDetailsLoadingSkeleton({
  book,
  canDeleteBook = true,
  canManageFile = false,
  canRevealFile = false,
}: BookDetailsLoadingSkeletonProps) {
  const title = bookTitle(book);
  const author = bookAuthor(book);
  const progress = Math.max(0, Math.min(100, book.progressPercent ?? 0));
  const hasSavedPosition = Boolean(book.progressCfi) || progress > 0;
  const secondaryActionCount = 1 + Number(canRevealFile) + (canManageFile ? 2 : 0);
  const hasDescription = Boolean(book.sourceMetadata?.description?.trim());

  return (
    <>
      <div className="book-details-loading" aria-busy="true">
        <div className="details-drawer__body" aria-hidden="true">
          <div className="details-cover">
            <span className="book-details-loading__placeholder book-details-loading__cover" />
          </div>

          <div className="details-drawer__title constrained-user-content">
            <h2 id="book-details-title">{title}</h2>
            {author ? <p>{author}</p> : null}
            {hasSavedPosition ? (
              <div className="details-progress-controls">
                <span className="book-details-loading__placeholder book-details-loading__pill" />
                <span className="book-details-loading__placeholder book-details-loading__icon" />
              </div>
            ) : null}
          </div>

          {book.isFileMissing ? (
            <section className="details-missing book-details-loading__missing">
              <span className="book-details-loading__placeholder book-details-loading__missing-icon" />
              <div>
                <span className="book-details-loading__placeholder book-details-loading__line book-details-loading__line--heading" />
                <span className="book-details-loading__placeholder book-details-loading__line book-details-loading__line--copy" />
              </div>
              <div>
                <span className="book-details-loading__placeholder book-details-loading__action book-details-loading__action--compact" />
                <span className="book-details-loading__placeholder book-details-loading__action book-details-loading__action--compact" />
              </div>
            </section>
          ) : (
            <div className="details-actions">
              <span className="book-details-loading__placeholder book-details-loading__action" />
              {hasSavedPosition ? (
                <span className="book-details-loading__placeholder book-details-loading__action" />
              ) : null}
              <div className="details-actions__secondary">
                {Array.from({ length: secondaryActionCount }, (_, index) => (
                  <span
                    className="book-details-loading__placeholder book-details-loading__action book-details-loading__action--compact"
                    key={index}
                  />
                ))}
              </div>
            </div>
          )}

          {hasDescription ? (
            <section className="details-description book-details-loading__description">
              <h3>Description</h3>
              <div className="book-details-loading__description-lines">
                <span className="book-details-loading__placeholder book-details-loading__line" />
                <span className="book-details-loading__placeholder book-details-loading__line" />
                <span className="book-details-loading__placeholder book-details-loading__line book-details-loading__line--short" />
              </div>
            </section>
          ) : null}

          <dl className="book-metadata book-metadata--compact book-details-loading__metadata">
            <div>
              <dt>File</dt>
              <dd>
                <span className="book-details-loading__placeholder book-details-loading__line book-details-loading__line--path" />
                <span className="book-details-loading__placeholder book-details-loading__line book-details-loading__line--size" />
              </dd>
            </div>
            {book.lastOpenedAt ? (
              <div>
                <dt>Last opened</dt>
                <dd>
                  <span className="book-details-loading__placeholder book-details-loading__line book-details-loading__line--date" />
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        {canDeleteBook && !book.isFileMissing ? (
          <footer className="details-drawer__footer" aria-hidden="true">
            <span className="book-details-loading__placeholder book-details-loading__action book-details-loading__action--footer" />
          </footer>
        ) : null}
      </div>
      <span className="sr-only" role="status">
        Loading book details
      </span>
    </>
  );
}
