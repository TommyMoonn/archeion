import type { Annotation } from "../../types/annotation";
import type { ReaderChapter } from "../../types/reader";
import {
  groupReaderAnnotations,
  visibleReaderAnnotations,
  type ReaderAnnotationGroup,
  type ReaderAnnotationSort,
  type ReaderAnnotationView,
} from "./readerAnnotations";

export const READER_ANNOTATION_RENDER_BATCH = 200;

export type ReaderAnnotationListModel = {
  groups: ReaderAnnotationGroup[];
  hasMore: boolean;
  remaining: number;
  renderedAnnotations: Annotation[];
  visibleAnnotations: Annotation[];
};

export function createReaderAnnotationListModel({
  annotations,
  chapters,
  query,
  renderLimit,
  sort,
  view,
}: {
  annotations: readonly Annotation[];
  chapters: readonly ReaderChapter[];
  query: string;
  renderLimit: number;
  sort: ReaderAnnotationSort;
  view: ReaderAnnotationView;
}): ReaderAnnotationListModel {
  const visibleAnnotations = visibleReaderAnnotations({
    annotations,
    chapters,
    query,
    sort,
    view,
  });
  const renderedAnnotations = visibleAnnotations.slice(0, renderLimit);

  return {
    groups: groupReaderAnnotations(renderedAnnotations, chapters),
    hasMore: renderLimit < visibleAnnotations.length,
    remaining: Math.max(visibleAnnotations.length - renderLimit, 0),
    renderedAnnotations,
    visibleAnnotations,
  };
}

export function nextReaderAnnotationRenderLimit(current: number): number {
  return current + READER_ANNOTATION_RENDER_BATCH;
}

export function readerAnnotationSurvivingRowId(
  visibleAnnotations: readonly Annotation[],
  removedAnnotationId: string,
): string | undefined {
  const index = visibleAnnotations.findIndex((annotation) => annotation.id === removedAnnotationId);
  if (index < 0) return undefined;
  return visibleAnnotations[index + 1]?.id ?? visibleAnnotations[index - 1]?.id;
}

export function readerAnnotationFocusFallbackId(
  requestedAnnotationId: string | undefined,
  availableAnnotationIds: readonly string[],
): string | undefined {
  if (requestedAnnotationId && availableAnnotationIds.includes(requestedAnnotationId)) {
    return requestedAnnotationId;
  }
  return availableAnnotationIds[0];
}
