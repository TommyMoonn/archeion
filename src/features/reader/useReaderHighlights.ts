import { useCallback, useMemo, useState } from "react";

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

type UseReaderHighlightsOptions = {
  annotations: readonly Annotation[];
  bookId?: string;
  onAnnotationChange: (annotation: Annotation) => void;
  onAnnotationRemove: (annotationId: string) => void;
  storage: LibraryStorage;
};

export function useReaderHighlights({
  annotations,
  bookId,
  onAnnotationChange,
  onAnnotationRemove,
  storage,
}: UseReaderHighlightsOptions) {
  const [error, setError] = useState<string | null>(null);
  const visibleAnnotations = useMemo(() => readerHighlights(annotations), [annotations]);

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
          if (updated) onAnnotationChange(updated);
        } else {
          const created = await storage.createAnnotation(bookId, {
            type: "highlight",
            cfiRange: selection.cfiRange,
            chapterHref: selection.chapterHref,
            selectedText,
            color,
          });
          onAnnotationChange(created);
        }
        setError(null);
        return true;
      } catch {
        setError("The highlight could not be saved.");
        return false;
      }
    },
    [bookId, onAnnotationChange, storage, visibleAnnotations],
  );

  const ensure = useCallback(
    async (selection: HighlightSelection) => {
      if (!bookId) return undefined;
      const existing = visibleAnnotations.find((item) => item.cfiRange === selection.cfiRange);
      if (existing) return existing;
      const selectedText = selection.selectedText.trim();
      if (!selectedText || selectedText.length > MAX_HIGHLIGHT_TEXT_LENGTH) {
        setError("Select fewer than 5,000 characters to add a note.");
        return undefined;
      }
      try {
        const created = await storage.createAnnotation(bookId, {
          type: "highlight",
          cfiRange: selection.cfiRange,
          chapterHref: selection.chapterHref,
          selectedText,
          color: "yellow",
        });
        onAnnotationChange(created);
        setError(null);
        return created;
      } catch {
        setError("The highlight for this note could not be saved.");
        return undefined;
      }
    },
    [bookId, onAnnotationChange, storage, visibleAnnotations],
  );

  const recolor = useCallback(
    async (id: string, color: ReaderHighlightColor) => {
      if (!bookId) return false;
      try {
        const updated = await storage.updateAnnotation(bookId, id, {
          color: normalizeReaderHighlightColor(color),
        });
        if (!updated) return false;
        onAnnotationChange(updated);
        setError(null);
        return true;
      } catch {
        setError("The highlight color could not be changed.");
        return false;
      }
    },
    [bookId, onAnnotationChange, storage],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!bookId) return false;
      try {
        const removed = await storage.deleteAnnotation(bookId, id);
        if (removed) onAnnotationRemove(id);
        setError(null);
        return removed;
      } catch {
        setError("The highlight could not be removed.");
        return false;
      }
    },
    [bookId, onAnnotationRemove, storage],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      highlights: visibleAnnotations,
      create,
      ensure,
      recolor,
      remove,
      error,
      clearError,
    }),
    [clearError, create, ensure, error, recolor, remove, visibleAnnotations],
  );
}
