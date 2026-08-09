import type {
  Annotation,
  AnnotationAnchorStatus,
  BookmarkAnnotation,
  CreateAnnotationInput,
  HighlightAnnotation,
  UpdateBookmarkAnnotationInput,
  UpdateHighlightAnnotationInput,
} from "../../types/annotation";

export type ReaderAnnotationSession = {
  archiveId: string | null;
  bookId?: string;
  token: symbol;
};

export type ReaderAnnotationIdentity = Readonly<{
  annotationId: string;
  annotationType: Annotation["type"];
  createdAt: string;
}>;

export type ReaderAnnotationAnchorChanges = {
  anchorStatus?: AnnotationAnchorStatus;
  cfiRange?: string;
  chapterHref?: string;
};

export type ReaderAnnotationMutation = {
  id: number;
  session: ReaderAnnotationSession;
};

export type ReaderAnnotationCreateCommand = CreateAnnotationInput;

export type ReaderAnnotationUpdateCommand =
  | {
      annotation: BookmarkAnnotation;
      annotationType: "bookmark";
      changes: UpdateBookmarkAnnotationInput;
    }
  | {
      annotation: HighlightAnnotation;
      annotationType: "highlight";
      changes: UpdateHighlightAnnotationInput;
    };

export type ReaderAnnotationMutationOutcome<T extends Annotation = Annotation> =
  { annotation: T; status: "accepted" } | { status: "failed" | "rejected" | "retired" };

export function sameReaderAnnotationSession(
  left: ReaderAnnotationSession,
  right: ReaderAnnotationSession,
): boolean {
  return (
    left.archiveId === right.archiveId && left.bookId === right.bookId && left.token === right.token
  );
}

export function readerAnnotationIdentity(annotation: Annotation): ReaderAnnotationIdentity {
  return {
    annotationId: annotation.id,
    annotationType: annotation.type,
    createdAt: annotation.createdAt,
  };
}

export function annotationMatchesReaderIdentity(
  annotation: Annotation | undefined,
  identity: ReaderAnnotationIdentity,
): boolean {
  return Boolean(
    annotation &&
    annotation.id === identity.annotationId &&
    annotation.type === identity.annotationType &&
    annotation.createdAt === identity.createdAt,
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
