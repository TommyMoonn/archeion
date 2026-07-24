import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

import type { ReadonlyBook } from "../../types/book";
import {
  focusElementIfRestorationOwned,
  focusIsUnowned,
  isUsableFocusTarget,
} from "../../utils/focusRestoration";
import {
  subscribeTransientSurfaceOwnership,
  transientSurfaceOriginatesFrom,
  transientSurfaceOwnershipSnapshot,
} from "../../utils/transientSurfaceOwnership";
import type { LibraryReturnFocusRequest } from "./useLibraryCollectionWindow";

type CapturedCollectionFocus = Readonly<{
  bookId: string;
  index: number;
  origin: HTMLElement;
  ownerKey: string;
  token: number;
}>;

type UseBookCollectionFocusPreservationInput = {
  active: boolean;
  books: readonly ReadonlyBook[];
  collectionRootRef: RefObject<HTMLElement | null>;
  fallbackRef: RefObject<HTMLElement | null>;
  ownerKey: string;
  revision: string;
  suspended: boolean;
};

export function useBookCollectionFocusPreservation({
  active,
  books,
  collectionRootRef,
  fallbackRef,
  ownerKey,
  revision,
  suspended,
}: UseBookCollectionFocusPreservationInput): LibraryReturnFocusRequest | null {
  const booksRef = useRef(books);
  const focusedRef = useRef<CapturedCollectionFocus | null>(null);
  const tokenRef = useRef(0);
  const focusChangeTokenRef = useRef(0);
  const [pending, setPending] = useState<CapturedCollectionFocus | null>(null);
  const pendingRef = useRef<CapturedCollectionFocus | null>(null);
  const transientRevision = useSyncExternalStore(
    subscribeTransientSurfaceOwnership,
    transientSurfaceOwnershipSnapshot,
    transientSurfaceOwnershipSnapshot,
  );

  useLayoutEffect(() => {
    booksRef.current = books;
  }, [books]);

  useLayoutEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useLayoutEffect(() => {
    focusedRef.current = null;
    const focusChangeToken = ++focusChangeTokenRef.current;
    queueMicrotask(() => {
      if (focusChangeTokenRef.current === focusChangeToken) setPending(null);
    });
  }, [ownerKey]);

  useLayoutEffect(() => {
    function retireCapturedFocus() {
      focusedRef.current = null;
      setPending(null);
    }

    function handleFocusIn(event: FocusEvent) {
      const root = collectionRootRef.current;
      const target = event.target;
      if (!active || !root || !(target instanceof HTMLElement)) {
        retireCapturedFocus();
        return;
      }
      if (!root.contains(target)) {
        const focusChangeToken = ++focusChangeTokenRef.current;
        queueMicrotask(() => {
          if (focusChangeTokenRef.current !== focusChangeToken) return;
          const captured = focusedRef.current;
          if (!captured || transientSurfaceOriginatesFrom(captured.origin)) return;
          const currentRoot = collectionRootRef.current;
          const activeElement = target.ownerDocument.activeElement;
          if (
            activeElement instanceof HTMLElement &&
            !focusIsUnowned(target.ownerDocument) &&
            !currentRoot?.contains(activeElement)
          ) {
            retireCapturedFocus();
          }
        });
        return;
      }
      focusChangeTokenRef.current += 1;
      const owner = target.closest<HTMLElement>("[data-reader-book-id]");
      const bookId = owner?.dataset.readerBookId;
      const index = bookId ? booksRef.current.findIndex((book) => book.id === bookId) : -1;
      const captured =
        bookId && index >= 0
          ? { bookId, index, origin: target, ownerKey, token: ++tokenRef.current }
          : null;
      focusedRef.current = captured;
      if (pendingRef.current) {
        const focusChangeToken = focusChangeTokenRef.current;
        queueMicrotask(() => {
          if (focusChangeTokenRef.current === focusChangeToken) setPending(null);
        });
      }
    }

    document.addEventListener("focusin", handleFocusIn);
    return () => {
      focusChangeTokenRef.current += 1;
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [active, collectionRootRef, ownerKey]);

  useLayoutEffect(() => {
    const captured = focusedRef.current;
    if (!active || suspended) {
      focusedRef.current = null;
      const focusChangeToken = ++focusChangeTokenRef.current;
      queueMicrotask(() => {
        if (focusChangeTokenRef.current === focusChangeToken) setPending(null);
      });
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (!active || suspended) {
        setPending(null);
        return;
      }
      if (!captured) return;

      const ownedTransientActive = transientSurfaceOriginatesFrom(captured.origin);
      const activeElement = document.activeElement;
      const root = collectionRootRef.current;
      if (
        !ownedTransientActive &&
        !focusIsUnowned() &&
        activeElement instanceof HTMLElement &&
        isUsableFocusTarget(activeElement) &&
        !root?.contains(activeElement)
      ) {
        focusedRef.current = null;
        setPending(null);
        return;
      }

      if (!ownedTransientActive && !focusIsUnowned()) return;

      const currentBooks = booksRef.current;
      const currentIndex = currentBooks.findIndex((book) => book.id === captured.bookId);
      if (isUsableFocusTarget(captured.origin) && currentIndex >= 0) {
        focusedRef.current = { ...captured, index: currentIndex };
        setPending(null);
        return;
      }

      if (currentBooks.length === 0) {
        if (ownedTransientActive) {
          setPending(captured);
          return;
        }
        focusedRef.current = null;
        setPending(null);
        focusElementIfRestorationOwned(fallbackRef.current, {
          invalidatedOrigin: captured.origin,
        });
        return;
      }
      setPending(captured);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    active,
    books.length,
    collectionRootRef,
    fallbackRef,
    revision,
    suspended,
    transientRevision,
  ]);

  const target = useMemo(() => {
    if (!pending || books.length === 0) return null;
    const sameBookIndex = books.findIndex((book) => book.id === pending.bookId);
    const index = sameBookIndex >= 0 ? sameBookIndex : Math.min(pending.index, books.length - 1);
    const book = books[index];
    return book ? { bookId: book.id, index } : null;
  }, [books, pending]);

  const pendingOwnedByTransient = Boolean(
    pending && transientSurfaceOriginatesFrom(pending.origin),
  );

  return active &&
    !suspended &&
    pending?.ownerKey === ownerKey &&
    target &&
    !pendingOwnedByTransient
    ? {
        bookId: target.bookId,
        index: target.index,
        onTargetReady: (bookId, index, focusTarget) => {
          setPending((current) => {
            if (
              !current ||
              current.token !== pending.token ||
              bookId !== target.bookId ||
              index !== target.index
            ) {
              return current;
            }
            focusElementIfRestorationOwned(focusTarget, {
              invalidatedOrigin: current.origin,
              requestIsCurrent: () => focusedRef.current?.token === current.token,
            });
            focusedRef.current = null;
            return null;
          });
        },
      }
    : null;
}
