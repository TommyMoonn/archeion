import { useCallback, useEffect, useMemo, useState } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation } from "../../types/annotation";
import {
  MAX_HIGHLIGHT_TEXT_LENGTH,
  normalizeReaderHighlightColor,
  readerHighlights,
  type ReaderHighlightColor,
} from "./readerHighlights";

type HighlightSelection = {
  cfiRange: string;
  chapterHref?: string;
  selectedText: string;
};

export function useReaderHighlights({
  bookId,
  storage,
}: {
  bookId?: string;
  storage: LibraryStorage;
}) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loadedBookId, setLoadedBookId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const visibleAnnotations = useMemo(
    () => (loadedBookId === bookId ? annotations : []),
    [annotations, bookId, loadedBookId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!bookId) return;
    void storage
      .listAnnotations(bookId)
      .then((items) => {
        if (!cancelled) {
          setAnnotations(readerHighlights(items));
          setLoadedBookId(bookId);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Highlights could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, storage]);

  const create = useCallback(
    async (selection: HighlightSelection, color: ReaderHighlightColor) => {
      if (!bookId) return false;
      const selectedText = selection.selectedText.trim();
      if (!selectedText || selectedText.length > MAX_HIGHLIGHT_TEXT_LENGTH) {
        setError(
          selectedText.length > MAX_HIGHLIGHT_TEXT_LENGTH
            ? "Select fewer than 5,000 characters to highlight."
            : "Select text before adding a highlight.",
        );
        return false;
      }

      const existing = visibleAnnotations.find((item) => item.cfiRange === selection.cfiRange);
      try {
        if (existing) {
          const updated = await storage.updateAnnotation(bookId, existing.id, { color });
          if (updated) {
            setAnnotations((items) =>
              items.map((item) => (item.id === updated.id ? updated : item)),
            );
          }
        } else {
          const created = await storage.createAnnotation(bookId, {
            type: "highlight",
            cfiRange: selection.cfiRange,
            chapterHref: selection.chapterHref,
            selectedText,
            color,
          });
          setAnnotations((items) => readerHighlights([...items, created]));
        }
        setError(null);
        return true;
      } catch {
        setError("The highlight could not be saved.");
        return false;
      }
    },
    [bookId, storage, visibleAnnotations],
  );

  const recolor = useCallback(
    async (id: string, color: ReaderHighlightColor) => {
      if (!bookId) return false;
      try {
        const updated = await storage.updateAnnotation(bookId, id, {
          color: normalizeReaderHighlightColor(color),
        });
        if (!updated) return false;
        setAnnotations((items) => items.map((item) => (item.id === id ? updated : item)));
        setError(null);
        return true;
      } catch {
        setError("The highlight color could not be changed.");
        return false;
      }
    },
    [bookId, storage],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!bookId) return false;
      try {
        const removed = await storage.deleteAnnotation(bookId, id);
        if (removed) setAnnotations((items) => items.filter((item) => item.id !== id));
        setError(null);
        return removed;
      } catch {
        setError("The highlight could not be removed.");
        return false;
      }
    },
    [bookId, storage],
  );

  return useMemo(
    () => ({
      highlights: visibleAnnotations,
      create,
      recolor,
      remove,
      error,
      clearError: () => setError(null),
    }),
    [create, error, recolor, remove, visibleAnnotations],
  );
}
