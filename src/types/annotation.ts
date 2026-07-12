export const ANNOTATION_TYPES = ["bookmark", "highlight", "note"] as const;

export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export type Annotation = Record<string, unknown> & {
  id: string;
  type: AnnotationType;
  cfiRange?: string;
  chapterHref?: string;
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  color?: string;
  note?: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
};

export type BookAnnotations = Record<string, unknown> & {
  annotations: Annotation[];
};

export type AnnotationsMetadata = Record<string, unknown> & {
  version: 1;
  books: Record<string, BookAnnotations>;
};

export type CreateAnnotationInput = Record<string, unknown> & {
  type: AnnotationType;
  cfiRange?: string;
  chapterHref?: string;
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  color?: string;
  note?: string;
  label?: string;
};

export type UpdateAnnotationInput = Record<string, unknown> & {
  cfiRange?: string;
  chapterHref?: string;
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  color?: string;
  note?: string;
  label?: string;
};
