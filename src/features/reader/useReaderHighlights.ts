import { useCallback, useMemo, useState } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation } from "../../types/annotation";
import {
  MAX_HIGHLIGHT_TEXT_LENGTH,
  normalizeReaderHighlightColor,
  readerHighlights,
  type ReaderHighlightColor,
} from "./readerHighlights";
import { resolveHighlightSelection } from "./readerHighlightInteraction";

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

export type ReaderHighlightFeedback = {
  kind: "interaction" | "persistence";
  message: string;
};

function sameFeedback(
  current: ReaderHighlightFeedback | null,
  next: ReaderHighlightFeedback,
): ReaderHighlightFeedback {
  return current?.kind === next.kind && current.message === next.message ? current : next;
}

export function useReaderHighlights({
  annotations,
  bookId,
  onAnnotationChange,
  onAnnotationRemove,
  storage,
}: UseReaderHighlightsOptions) {
  const [feedback, setFeedback] = useState<ReaderHighlightFeedback | null>(null);
  const visibleAnnotations = useMemo(() => readerHighlights(annotations), [annotations]);

  const create = useCallback(
    async (selection: HighlightSelection, color: ReaderHighlightColor) => {
      if (!bookId) return false;
      const selectedText = selection.selectedText.trim();
      if (!selectedText || selectedText.length > MAX_HIGHLIGHT_TEXT_LENGTH) {
        setFeedback((current) =>
          sameFeedback(current, {
            kind: "interaction",
            message:
              selectedText.length > MAX_HIGHLIGHT_TEXT_LENGTH
                ? "Select fewer than 5,000 characters to highlight."
                : "Select text before adding a highlight.",
          }),
        );
        return false;
      }

      const resolution = resolveHighlightSelection(selection.cfiRange, visibleAnnotations);
      if (resolution.kind === "blocked") {
        setFeedback((current) =>
          sameFeedback(current, {
            kind: "interaction",
            message: "Overlapping highlights cannot be edited together.",
          }),
        );
        return false;
      }
      try {
        if (resolution.kind === "existing") {
          const updated = await storage.updateAnnotation(bookId, resolution.highlight.id, {
            color,
          });
          if (updated?.type === "highlight") onAnnotationChange(updated);
        } else {
          const created = await storage.createAnnotation(bookId, {
            type: "highlight",
            cfiRange: selection.cfiRange,
            chapterHref: selection.chapterHref,
            selectedText,
            color,
          });
          if (created.type !== "highlight") return false;
          onAnnotationChange(created);
        }
        setFeedback(null);
        return true;
      } catch {
        setFeedback({ kind: "persistence", message: "The highlight could not be saved." });
        return false;
      }
    },
    [bookId, onAnnotationChange, storage, visibleAnnotations],
  );

  const ensure = useCallback(
    async (selection: HighlightSelection) => {
      if (!bookId) return undefined;
      const resolution = resolveHighlightSelection(selection.cfiRange, visibleAnnotations);
      if (resolution.kind === "existing") return resolution.highlight;
      if (resolution.kind === "blocked") {
        setFeedback((current) =>
          sameFeedback(current, {
            kind: "interaction",
            message: "Overlapping highlights cannot be edited together.",
          }),
        );
        return undefined;
      }
      const selectedText = selection.selectedText.trim();
      if (!selectedText || selectedText.length > MAX_HIGHLIGHT_TEXT_LENGTH) {
        setFeedback((current) =>
          sameFeedback(current, {
            kind: "interaction",
            message: "Select fewer than 5,000 characters to add a note.",
          }),
        );
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
        if (created.type !== "highlight") return undefined;
        onAnnotationChange(created);
        setFeedback(null);
        return created;
      } catch {
        setFeedback({
          kind: "persistence",
          message: "The highlight for this note could not be saved.",
        });
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
        if (!updated || updated.type !== "highlight") return false;
        onAnnotationChange(updated);
        setFeedback(null);
        return true;
      } catch {
        setFeedback({
          kind: "persistence",
          message: "The highlight color could not be changed.",
        });
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
        setFeedback(null);
        return removed;
      } catch {
        setFeedback({ kind: "persistence", message: "The highlight could not be removed." });
        return false;
      }
    },
    [bookId, onAnnotationRemove, storage],
  );

  const clearFeedback = useCallback(() => setFeedback(null), []);
  const clearInteractionFeedback = useCallback(
    () => setFeedback((current) => (current?.kind === "interaction" ? null : current)),
    [],
  );
  const reportInteractionFeedback = useCallback(
    (message: string) =>
      setFeedback((current) => sameFeedback(current, { kind: "interaction", message })),
    [],
  );

  return useMemo(
    () => ({
      highlights: visibleAnnotations,
      create,
      ensure,
      recolor,
      remove,
      error: feedback?.message ?? null,
      feedback,
      clearFeedback,
      clearInteractionFeedback,
      reportInteractionFeedback,
    }),
    [
      clearFeedback,
      clearInteractionFeedback,
      create,
      ensure,
      feedback,
      recolor,
      remove,
      reportInteractionFeedback,
      visibleAnnotations,
    ],
  );
}
