import { Suspense } from "react";
import { createAsyncSurface } from "../../components/createAsyncSurface";
import { BookDetailsDrawerFrame } from "./BookDetailsDrawerFrame";
import type { BookDetailsDrawerProps } from "./BookDetailsDrawer";
import { bookTitle } from "./libraryFilters";
const DrawerContent = createAsyncSurface<BookDetailsDrawerProps>(() =>
  import("./BookDetailsDrawer").then((module) => ({ default: module.BookDetailsDrawerContent })),
);

export function BookDetailsDrawer(props: BookDetailsDrawerProps) {
  return (
    <BookDetailsDrawerFrame {...props}>
      <Suspense
        fallback={
          <div className="details-drawer__body" aria-busy="true">
            <h2 id="book-details-title">{bookTitle(props.book)}</h2>
            <p role="status">Opening book details…</p>
          </div>
        }
      >
        <DrawerContent {...props} />
      </Suspense>
    </BookDetailsDrawerFrame>
  );
}
