export const ANNOTATION_TYPES = ["bookmark", "highlight"] as const;

export type AnnotationType = (typeof ANNOTATION_TYPES)[number];
export type AnnotationAnchorStatus = "detached";

type AnnotationBase = {
  anchorStatus?: AnnotationAnchorStatus;
  id: string;
  chapterHref?: string;
  createdAt: string;
  updatedAt: string;
};

export type BookmarkAnnotation = AnnotationBase & {
  type: "bookmark";
  cfiRange?: string;
  label?: string;
  selectedText?: never;
  contextBefore?: never;
  contextAfter?: never;
  color?: never;
  note?: never;
};

export type HighlightAnnotation = AnnotationBase & {
  type: "highlight";
  cfiRange: string;
  selectedText: string;
  contextBefore?: string;
  contextAfter?: string;
  color: string;
  note?: string;
  label?: never;
};

export type Annotation = BookmarkAnnotation | HighlightAnnotation;

export type CreateBookmarkAnnotationInput = {
  type: "bookmark";
  cfiRange?: string;
  chapterHref?: string;
  label?: string;
};

export type CreateHighlightAnnotationInput = {
  type: "highlight";
  cfiRange: string;
  chapterHref?: string;
  selectedText: string;
  contextBefore?: string;
  contextAfter?: string;
  color: string;
  note?: string;
};

export type CreateAnnotationInput = CreateBookmarkAnnotationInput | CreateHighlightAnnotationInput;

export type UpdateBookmarkAnnotationInput = {
  anchorStatus?: AnnotationAnchorStatus;
  cfiRange?: string;
  chapterHref?: string;
  label?: string;
  selectedText?: never;
  contextBefore?: never;
  contextAfter?: never;
  color?: never;
  note?: never;
};

export type UpdateHighlightAnnotationInput = {
  anchorStatus?: AnnotationAnchorStatus;
  cfiRange?: string;
  chapterHref?: string;
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  color?: string;
  note?: string;
  label?: never;
};
