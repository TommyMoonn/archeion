import type { Annotation, AnnotationAnchorStatus } from "../../types/annotation";

export type ReaderAnnotationSession = {
  archiveId: string | null;
  bookId?: string;
  token: symbol;
};

export type ReaderAnnotationAnchorChanges = {
  anchorStatus?: AnnotationAnchorStatus;
  cfiRange?: string;
  chapterHref?: string;
};

export type ReaderAnnotationMutation = {
  id: number;
  session: ReaderAnnotationSession;
};

export function sameReaderAnnotationSession(
  left: ReaderAnnotationSession,
  right: ReaderAnnotationSession,
): boolean {
  return (
    left.archiveId === right.archiveId && left.bookId === right.bookId && left.token === right.token
  );
}

export function upsertReaderAnnotation(
  annotations: readonly Annotation[],
  annotation: Annotation,
): Annotation[] {
  const index = annotations.findIndex((candidate) => candidate.id === annotation.id);
  if (index < 0) return [...annotations, annotation];
  if (annotations[index] === annotation) return [...annotations];

  const next = [...annotations];
  next[index] = annotation;
  return next;
}
