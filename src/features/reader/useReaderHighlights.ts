import { useCallback, useMemo, useState } from "react";

import type { Annotation } from "../../types/annotation";
import {
  MAX_HIGHLIGHT_TEXT_LENGTH,
  normalizeReaderHighlightColor,
  readerHighlights,
  type ReaderHighlightColor,
} from "./readerHighlights";
import { resolveHighlightSelection } from "./readerHighlightInteraction";
import type { ReaderAnnotationCommandSurface } from "./useReaderAnnotationMutations";

type HighlightSelection = {
  cfiRange: string;
  chapterHref?: string;
  contextAfter?: string;
  contextBefore?: string;
  selectedText: string;
};

type UseReaderHighlightsOptions = {
  annotations: readonly Annotation[];
  bookId?: string;
  mutations: ReaderAnnotationCommandSurface;
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
  mutations,
}: UseReaderHighlightsOptions) {
  const [feedback, setFeedback] = useState<ReaderHighlightFeedback | null>(null);
  const allHighlights = useMemo(
    () =>
      annotations.filter(
        (annotation): annotation is Extract<Annotation, { type: "highlight" }> =>
          annotation.type === "highlight",
      ),
    [annotations],
  );
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
      const outcome =
        resolution.kind === "existing"
          ? await mutations.update({
              annotation: resolution.highlight,
              annotationType: "highlight",
              changes: { color },
            })
          : await mutations.create({
              type: "highlight",
              cfiRange: selection.cfiRange,
              chapterHref: selection.chapterHref,
              ...(selection.contextAfter ? { contextAfter: selection.contextAfter } : {}),
              ...(selection.contextBefore ? { contextBefore: selection.contextBefore } : {}),
              selectedText,
              color,
            });
      if (outcome.status === "accepted" && outcome.annotation.type === "highlight") {
        setFeedback(null);
        return true;
      }
      if (outcome.status === "failed") {
        setFeedback({ kind: "persistence", message: "The highlight could not be saved." });
      }
      return false;
    },
    [bookId, mutations, visibleAnnotations],
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
      const outcome = await mutations.create({
        type: "highlight",
        cfiRange: selection.cfiRange,
        chapterHref: selection.chapterHref,
        ...(selection.contextAfter ? { contextAfter: selection.contextAfter } : {}),
        ...(selection.contextBefore ? { contextBefore: selection.contextBefore } : {}),
        selectedText,
        color: "yellow",
      });
      if (outcome.status === "accepted" && outcome.annotation.type === "highlight") {
        setFeedback(null);
        return outcome.annotation;
      }
      if (outcome.status === "failed") {
        setFeedback({
          kind: "persistence",
          message: "The highlight for this note could not be saved.",
        });
      }
      return undefined;
    },
    [bookId, mutations, visibleAnnotations],
  );

  const recolor = useCallback(
    async (id: string, color: ReaderHighlightColor) => {
      const highlight = allHighlights.find((annotation) => annotation.id === id);
      if (!highlight) return false;
      const outcome = await mutations.update({
        annotation: highlight,
        annotationType: "highlight",
        changes: { color: normalizeReaderHighlightColor(color) },
      });
      if (outcome.status === "accepted" && outcome.annotation.type === "highlight") {
        setFeedback(null);
        return true;
      }
      if (outcome.status === "failed") {
        setFeedback({
          kind: "persistence",
          message: "The highlight color could not be changed.",
        });
      }
      return false;
    },
    [allHighlights, mutations],
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
      reportInteractionFeedback,
      visibleAnnotations,
    ],
  );
}
