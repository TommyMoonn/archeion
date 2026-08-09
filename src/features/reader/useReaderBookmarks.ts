import { useCallback, useMemo } from "react";

import type { Annotation, BookmarkAnnotation } from "../../types/annotation";
import type { ReaderLocation } from "./readerLocation";
import type { ReaderAnnotationSession } from "./readerAnnotationState";
import type { ReaderAnnotationMutationContext } from "./useReaderAnnotationMutations";

export function deriveReaderBookmarks(annotations: readonly Annotation[]): BookmarkAnnotation[] {
  return annotations
    .filter(
      (annotation): annotation is BookmarkAnnotation =>
        annotation.type === "bookmark" && typeof annotation.cfiRange === "string",
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function deriveReaderBookmarkState(annotations: readonly Annotation[], cfi: string) {
  const bookmarks = deriveReaderBookmarks(annotations);
  return {
    bookmarks,
    currentBookmark: bookmarks.find(
      (bookmark) => bookmark.anchorStatus !== "detached" && bookmark.cfiRange === cfi,
    ),
    detachedBookmarkAtCurrent: bookmarks.find(
      (bookmark) => bookmark.anchorStatus === "detached" && bookmark.cfiRange === cfi,
    ),
  };
}

type ReaderBookmarksOptions = {
  annotations: readonly Annotation[];
  busy: boolean;
  chapterHref?: string;
  chapterLabel?: string;
  location: ReaderLocation;
  mutations: ReaderAnnotationMutationContext;
  openingError: boolean;
  readerReady: boolean;
  session: ReaderAnnotationSession;
};

export function useReaderBookmarks({
  annotations,
  busy,
  chapterHref,
  chapterLabel,
  location,
  mutations,
  openingError,
  readerReady,
  session,
}: ReaderBookmarksOptions) {
  const { bookmarks, currentBookmark, detachedBookmarkAtCurrent } = useMemo(
    () => deriveReaderBookmarkState(annotations, location.cfi),
    [annotations, location.cfi],
  );
  const canToggleCurrent = Boolean(
    session.bookId && location.cfi && readerReady && !openingError && !busy,
  );
  const toggleDisabledReason = busy
    ? "Wait for the current bookmark action to finish."
    : openingError || !session.bookId
      ? "Current reading location is unavailable."
      : !readerReady || !location.cfi
        ? "Current reading location is still loading."
        : undefined;

  const addCurrent = useCallback(async () => {
    if (!location.cfi || !readerReady || openingError) return;
    const outcome = await mutations.create({
      type: "bookmark",
      cfiRange: location.cfi,
      chapterHref,
      label: chapterLabel,
    });
    if (outcome.status === "accepted") {
      mutations.publishFeedback(session);
    } else if (outcome.status === "failed") {
      mutations.publishFeedback(session, {
        kind: "error",
        message: "Bookmark could not be added.",
      });
    }
  }, [chapterHref, chapterLabel, location.cfi, mutations, openingError, readerReady, session]);

  const toggleCurrent = useCallback(async () => {
    if (currentBookmark) {
      await mutations.remove(currentBookmark);
      return;
    }
    if (!detachedBookmarkAtCurrent || !session.bookId) {
      await addCurrent();
      return;
    }

    const outcome = await mutations.update({
      annotation: detachedBookmarkAtCurrent,
      annotationType: "bookmark",
      changes: { anchorStatus: undefined, chapterHref },
    });
    if (outcome.status === "accepted") {
      mutations.publishFeedback(session);
    } else if (outcome.status === "failed") {
      mutations.publishFeedback(session, {
        kind: "error",
        message: "Bookmark could not be restored.",
      });
    }
  }, [addCurrent, chapterHref, currentBookmark, detachedBookmarkAtCurrent, mutations, session]);

  const updateLabel = useCallback(
    async (bookmark: BookmarkAnnotation, label: string) => {
      const outcome = await mutations.update({
        annotation: bookmark,
        annotationType: "bookmark",
        changes: { label },
      });
      if (outcome.status === "accepted") {
        return true;
      }
      if (outcome.status === "failed") {
        mutations.publishFeedback(session, {
          kind: "error",
          message: "Bookmark label could not be saved.",
        });
      }
      return false;
    },
    [mutations, session],
  );

  return useMemo(
    () => ({
      bookmarks,
      canToggleCurrent,
      currentBookmark,
      detachedBookmarkAtCurrent,
      toggleCurrent,
      toggleDisabledReason,
      updateLabel,
    }),
    [
      bookmarks,
      canToggleCurrent,
      currentBookmark,
      detachedBookmarkAtCurrent,
      toggleCurrent,
      toggleDisabledReason,
      updateLabel,
    ],
  );
}
