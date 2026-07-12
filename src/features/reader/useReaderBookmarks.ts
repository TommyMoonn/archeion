import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation } from "../../types/annotation";
import type { ReaderLocation } from "./readerLocation";

export type ReaderBookmarkFeedback =
  | { kind: "added"; message: string }
  | { kind: "error"; message: string }
  | { kind: "removed"; message: string; bookmark: Annotation };

type UseReaderBookmarksOptions = {
  bookId?: string;
  chapterHref?: string;
  chapterLabel?: string;
  location: ReaderLocation;
  readerReady: boolean;
  openingError: boolean;
  storage: LibraryStorage;
};

function isBookmark(annotation: Annotation): boolean {
  return annotation.type === "bookmark" && typeof annotation.cfiRange === "string";
}

function sortedBookmarks(annotations: readonly Annotation[]): Annotation[] {
  return annotations
    .filter(isBookmark)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function useReaderBookmarks({
  bookId,
  chapterHref,
  chapterLabel,
  location,
  readerReady,
  openingError,
  storage,
}: UseReaderBookmarksOptions) {
  const requestGeneration = useRef(0);
  const [bookmarks, setBookmarks] = useState<Annotation[]>([]);
  const [feedback, setFeedback] = useState<ReaderBookmarkFeedback>();
  const [busy, setBusy] = useState(false);

  const currentBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.cfiRange === location.cfi),
    [bookmarks, location.cfi],
  );

  const canToggleCurrent = Boolean(bookId && location.cfi && readerReady && !openingError && !busy);
  const toggleDisabledReason = busy
    ? "Wait for the current bookmark action to finish."
    : openingError || !bookId
      ? "Current reading location is unavailable."
      : !readerReady || !location.cfi
        ? "Current reading location is still loading."
        : undefined;

  useEffect(() => {
    const generation = ++requestGeneration.current;
    const pending = bookId ? storage.listAnnotations(bookId) : Promise.resolve([]);

    void pending
      .then((annotations) => {
        if (requestGeneration.current === generation) {
          setBookmarks(sortedBookmarks(annotations));
          setFeedback(undefined);
        }
      })
      .catch(() => {
        if (requestGeneration.current === generation) {
          setFeedback({ kind: "error", message: "Bookmarks could not be loaded." });
        }
      });

    return () => {
      requestGeneration.current += 1;
    };
  }, [bookId, storage]);

  const addCurrent = useCallback(async () => {
    if (!bookId || !location.cfi || !readerReady || openingError || busy) return;
    setBusy(true);
    try {
      const bookmark = await storage.createAnnotation(bookId, {
        type: "bookmark",
        cfiRange: location.cfi,
        chapterHref,
        label: chapterLabel,
      });
      setBookmarks((current) =>
        current.some((candidate) => candidate.id === bookmark.id)
          ? current
          : sortedBookmarks([...current, bookmark]),
      );
      setFeedback({ kind: "added", message: "Bookmark added." });
    } catch {
      setFeedback({ kind: "error", message: "Bookmark could not be added." });
    } finally {
      setBusy(false);
    }
  }, [bookId, busy, chapterHref, chapterLabel, location.cfi, openingError, readerReady, storage]);

  const remove = useCallback(
    async (bookmark: Annotation) => {
      if (!bookId || busy) return false;
      setBusy(true);
      try {
        const deleted = await storage.deleteAnnotation(bookId, bookmark.id);
        if (!deleted) return false;
        setBookmarks((current) => current.filter((candidate) => candidate.id !== bookmark.id));
        setFeedback({ kind: "removed", message: "Bookmark removed.", bookmark });
        return true;
      } catch {
        setFeedback({ kind: "error", message: "Bookmark could not be removed." });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [bookId, busy, storage],
  );

  const toggleCurrent = useCallback(async () => {
    if (currentBookmark) {
      await remove(currentBookmark);
    } else {
      await addCurrent();
    }
  }, [addCurrent, currentBookmark, remove]);

  const updateLabel = useCallback(
    async (bookmark: Annotation, label: string) => {
      if (!bookId || busy) return false;
      setBusy(true);
      try {
        const updated = await storage.updateAnnotation(bookId, bookmark.id, { label });
        if (!updated) return false;
        setBookmarks((current) =>
          current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
        );
        return true;
      } catch {
        setFeedback({ kind: "error", message: "Bookmark label could not be saved." });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [bookId, busy, storage],
  );

  const sync = useCallback((bookmark: Annotation) => {
    setBookmarks((current) =>
      current.map((candidate) => (candidate.id === bookmark.id ? bookmark : candidate)),
    );
  }, []);

  const undoRemove = useCallback(async () => {
    if (!bookId || feedback?.kind !== "removed" || busy) return;
    const removed = feedback.bookmark;
    const generation = requestGeneration.current;
    setBusy(true);
    try {
      const restored = await storage.restoreAnnotation(bookId, removed);
      if (requestGeneration.current !== generation) return;
      setBookmarks((current) =>
        current.some((candidate) => candidate.id === restored.id)
          ? current
          : sortedBookmarks([...current, restored]),
      );
      setFeedback({ kind: "added", message: "Bookmark restored." });
    } catch {
      if (requestGeneration.current === generation) {
        setFeedback({ kind: "error", message: "Bookmark could not be restored." });
      }
    } finally {
      if (requestGeneration.current === generation) {
        setBusy(false);
      }
    }
  }, [bookId, busy, feedback, storage]);

  return {
    bookmarks,
    busy,
    canToggleCurrent,
    currentBookmark,
    feedback,
    clearFeedback: () => setFeedback(undefined),
    remove,
    sync,
    toggleCurrent,
    toggleDisabledReason,
    undoRemove,
    updateLabel,
  };
}
