import { useCallback, useMemo } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
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
  storage: LibraryStorage;
  sync: (annotation: Annotation) => void;
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
  storage,
  sync,
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
    const mutation = mutations.beginMutation(session);
    if (!mutation || !session.bookId) return;
    try {
      const bookmark = await storage.createAnnotation(session.bookId, {
        type: "bookmark",
        cfiRange: location.cfi,
        chapterHref,
        label: chapterLabel,
      });
      if (!mutations.ownsMutation(mutation)) return;
      sync(bookmark);
      mutations.publishFeedback(session);
    } catch {
      if (mutations.ownsMutation(mutation)) {
        mutations.publishFeedback(session, {
          kind: "error",
          message: "Bookmark could not be added.",
        });
      }
    } finally {
      mutations.finishMutation(mutation);
    }
  }, [
    chapterHref,
    chapterLabel,
    location.cfi,
    mutations,
    openingError,
    readerReady,
    session,
    storage,
    sync,
  ]);

  const toggleCurrent = useCallback(async () => {
    if (currentBookmark) {
      await mutations.remove(currentBookmark);
      return;
    }
    if (!detachedBookmarkAtCurrent || !session.bookId) {
      await addCurrent();
      return;
    }

    const mutation = mutations.beginMutation(session);
    if (!mutation) return;
    try {
      const updated = await storage.updateBookmarkAnnotation(
        session.bookId,
        detachedBookmarkAtCurrent.id,
        { anchorStatus: undefined, chapterHref },
      );
      if (!mutations.ownsMutation(mutation)) return;
      if (!updated) {
        mutations.publishFeedback(session, {
          kind: "error",
          message: "Bookmark could not be restored.",
        });
        return;
      }
      sync(updated);
      mutations.publishFeedback(session);
    } catch {
      if (mutations.ownsMutation(mutation)) {
        mutations.publishFeedback(session, {
          kind: "error",
          message: "Bookmark could not be restored.",
        });
      }
    } finally {
      mutations.finishMutation(mutation);
    }
  }, [
    addCurrent,
    chapterHref,
    currentBookmark,
    detachedBookmarkAtCurrent,
    mutations,
    session,
    storage,
    sync,
  ]);

  const updateLabel = useCallback(
    async (bookmark: BookmarkAnnotation, label: string) => {
      const mutation = mutations.beginMutation(session);
      if (!mutation || !session.bookId) return false;
      try {
        const updated = await storage.updateBookmarkAnnotation(session.bookId, bookmark.id, {
          label,
        });
        if (!mutations.ownsMutation(mutation)) return false;
        if (!updated) {
          mutations.publishFeedback(session, {
            kind: "error",
            message: "Bookmark label could not be saved.",
          });
          return false;
        }
        sync(updated);
        return true;
      } catch {
        if (mutations.ownsMutation(mutation)) {
          mutations.publishFeedback(session, {
            kind: "error",
            message: "Bookmark label could not be saved.",
          });
        }
        return false;
      } finally {
        mutations.finishMutation(mutation);
      }
    },
    [mutations, session, storage, sync],
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
