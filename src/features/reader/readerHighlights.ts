import type { Annotation, HighlightAnnotation } from "../../types/annotation";

export const READER_HIGHLIGHT_COLORS = ["yellow", "green", "blue", "rose"] as const;
export type ReaderHighlightColor = (typeof READER_HIGHLIGHT_COLORS)[number];

export const DEFAULT_READER_HIGHLIGHT_COLOR: ReaderHighlightColor = "yellow";
export const MAX_HIGHLIGHT_TEXT_LENGTH = 5_000;

const highlightPaint: Record<ReaderHighlightColor, string> = {
  yellow: "#f2c94c",
  green: "#6fcf97",
  blue: "#56ccf2",
  rose: "#eb8fa3",
};

export function isReaderHighlightColor(value: unknown): value is ReaderHighlightColor {
  return READER_HIGHLIGHT_COLORS.includes(value as ReaderHighlightColor);
}

export function normalizeReaderHighlightColor(value: unknown): ReaderHighlightColor {
  return isReaderHighlightColor(value) ? value : DEFAULT_READER_HIGHLIGHT_COLOR;
}

export function readerHighlightStyles(color: unknown): Record<string, string> {
  return {
    fill: highlightPaint[normalizeReaderHighlightColor(color)],
    "fill-opacity": "0.32",
    "pointer-events": "none",
  };
}

export function readerHighlights(annotations: readonly Annotation[]): HighlightAnnotation[] {
  const ranges = new Set<string>();
  return annotations
    .filter(
      (annotation): annotation is HighlightAnnotation =>
        annotation.type === "highlight" && annotation.anchorStatus !== "detached",
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .filter((annotation) => {
      const range = annotation.cfiRange!.trim();
      if (ranges.has(range)) return false;
      ranges.add(range);
      return true;
    });
}
