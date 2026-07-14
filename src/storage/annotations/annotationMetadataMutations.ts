import type {
  Annotation,
  CreateAnnotationInput,
  UpdateBookmarkAnnotationInput,
  UpdateHighlightAnnotationInput,
} from "../../types/annotation";
import {
  normalizeAnnotationRecord,
  type StoredAnnotationRecord,
  type StoredAnnotationsMetadata,
  type StoredBookAnnotations,
  type StoredBookmarkAnnotation,
  type StoredHighlightAnnotation,
} from "./annotationsMetadata";

export type AnnotationMetadataMutation<T> = {
  changed: boolean;
  metadata: StoredAnnotationsMetadata;
  value: T;
};

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function optionalProperty<K extends PropertyKey, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function presentProperty<K extends PropertyKey>(source: object, key: K): object {
  return hasOwn(source, key) ? { [key]: Reflect.get(source, key) } : {};
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => jsonValuesEqual(entry, right[index]))
    );
  }
  if (
    typeof left === "object" &&
    left !== null &&
    !Array.isArray(left) &&
    typeof right === "object" &&
    right !== null &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && jsonValuesEqual(leftRecord[key], rightRecord[key]),
      )
    );
  }
  return false;
}

function replaceBookAnnotations(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  book: StoredBookAnnotations,
): StoredAnnotationsMetadata {
  return {
    ...metadata,
    books: {
      ...metadata.books,
      [bookId]: book,
    },
  };
}

function unchanged<T>(
  metadata: StoredAnnotationsMetadata,
  value: T,
): AnnotationMetadataMutation<T> {
  return { changed: false, metadata, value };
}

function changed<T>(metadata: StoredAnnotationsMetadata, value: T): AnnotationMetadataMutation<T> {
  return { changed: true, metadata, value };
}

function hasUnknownBookFields(book: StoredBookAnnotations): boolean {
  return Object.keys(book).some((key) => key !== "annotations");
}

function reviewedCreateRecord(input: CreateAnnotationInput, id: string, timestamp: string): object {
  const inputType: unknown = input.type;
  if (input.type === "bookmark") {
    return {
      id,
      type: "bookmark",
      ...optionalProperty("cfiRange", input.cfiRange),
      ...optionalProperty("chapterHref", input.chapterHref),
      ...optionalProperty("label", input.label),
      ...presentProperty(input, "selectedText"),
      ...presentProperty(input, "contextBefore"),
      ...presentProperty(input, "contextAfter"),
      ...presentProperty(input, "color"),
      ...presentProperty(input, "note"),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  if (input.type === "highlight") {
    return {
      id,
      type: "highlight",
      cfiRange: input.cfiRange,
      ...optionalProperty("chapterHref", input.chapterHref),
      selectedText: input.selectedText,
      ...optionalProperty("contextBefore", input.contextBefore),
      ...optionalProperty("contextAfter", input.contextAfter),
      color: input.color,
      ...optionalProperty("note", input.note),
      ...presentProperty(input, "label"),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  return { id, type: inputType, createdAt: timestamp, updatedAt: timestamp };
}

export function createAnnotationInMetadata(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  input: CreateAnnotationInput,
  id: string,
  timestamp: string,
): AnnotationMetadataMutation<StoredAnnotationRecord> {
  const annotation = normalizeAnnotationRecord(reviewedCreateRecord(input, id, timestamp), bookId);
  const existingBook = metadata.books[bookId];
  if (annotation.type === "bookmark" && annotation.cfiRange) {
    const existingBookmark = existingBook?.annotations.find(
      (candidate) => candidate.type === "bookmark" && candidate.cfiRange === annotation.cfiRange,
    );
    if (existingBookmark) return unchanged(metadata, existingBookmark);
  }

  const book = existingBook ?? { annotations: [] };
  if (book.annotations.some((candidate) => candidate.id === annotation.id)) {
    throw new Error(`Annotation id already exists: ${annotation.id}`);
  }
  return changed(
    replaceBookAnnotations(metadata, bookId, {
      ...book,
      annotations: [...book.annotations, annotation],
    }),
    annotation,
  );
}

export function restoreAnnotationInMetadata(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  annotation: Annotation,
): AnnotationMetadataMutation<StoredAnnotationRecord> {
  const restored = normalizeAnnotationRecord(structuredClone(annotation), bookId);
  const existingBook = metadata.books[bookId];
  const sameId = existingBook?.annotations.find((candidate) => candidate.id === restored.id);
  if (sameId) {
    if (jsonValuesEqual(sameId, restored)) return unchanged(metadata, sameId);
    throw new Error(
      `Annotation restore collision: id ${JSON.stringify(restored.id)} already exists in book ${JSON.stringify(bookId)}.`,
    );
  }

  if (restored.type === "bookmark" && restored.cfiRange) {
    const sameLocation = existingBook?.annotations.find(
      (candidate) => candidate.type === "bookmark" && candidate.cfiRange === restored.cfiRange,
    );
    if (sameLocation) {
      throw new Error(
        `Annotation restore collision: bookmark location already exists in book ${JSON.stringify(bookId)}.`,
      );
    }
  }

  const book = existingBook ?? { annotations: [] };
  return changed(
    replaceBookAnnotations(metadata, bookId, {
      ...book,
      annotations: [...book.annotations, restored],
    }),
    restored,
  );
}

function bookmarkUpdateCandidate(
  current: StoredBookmarkAnnotation,
  changes: UpdateBookmarkAnnotationInput,
): object {
  const preserved = { ...current };
  Reflect.deleteProperty(preserved, "anchorStatus");
  Reflect.deleteProperty(preserved, "cfiRange");
  Reflect.deleteProperty(preserved, "chapterHref");
  Reflect.deleteProperty(preserved, "label");

  return {
    ...preserved,
    ...optionalProperty(
      "anchorStatus",
      hasOwn(changes, "anchorStatus") ? changes.anchorStatus : current.anchorStatus,
    ),
    ...optionalProperty(
      "cfiRange",
      hasOwn(changes, "cfiRange") ? changes.cfiRange : current.cfiRange,
    ),
    ...optionalProperty(
      "chapterHref",
      hasOwn(changes, "chapterHref") ? changes.chapterHref : current.chapterHref,
    ),
    ...optionalProperty("label", hasOwn(changes, "label") ? changes.label : current.label),
  };
}

function highlightUpdateCandidate(
  current: StoredHighlightAnnotation,
  changes: UpdateHighlightAnnotationInput,
): object {
  const preserved = { ...current };
  Reflect.deleteProperty(preserved, "anchorStatus");
  Reflect.deleteProperty(preserved, "cfiRange");
  Reflect.deleteProperty(preserved, "chapterHref");
  Reflect.deleteProperty(preserved, "selectedText");
  Reflect.deleteProperty(preserved, "contextBefore");
  Reflect.deleteProperty(preserved, "contextAfter");
  Reflect.deleteProperty(preserved, "color");
  Reflect.deleteProperty(preserved, "note");

  return {
    ...preserved,
    ...optionalProperty(
      "anchorStatus",
      hasOwn(changes, "anchorStatus") ? changes.anchorStatus : current.anchorStatus,
    ),
    ...optionalProperty(
      "cfiRange",
      hasOwn(changes, "cfiRange") ? changes.cfiRange : current.cfiRange,
    ),
    ...optionalProperty(
      "chapterHref",
      hasOwn(changes, "chapterHref") ? changes.chapterHref : current.chapterHref,
    ),
    ...optionalProperty(
      "selectedText",
      hasOwn(changes, "selectedText") ? changes.selectedText : current.selectedText,
    ),
    ...optionalProperty(
      "contextBefore",
      hasOwn(changes, "contextBefore") ? changes.contextBefore : current.contextBefore,
    ),
    ...optionalProperty(
      "contextAfter",
      hasOwn(changes, "contextAfter") ? changes.contextAfter : current.contextAfter,
    ),
    ...optionalProperty("color", hasOwn(changes, "color") ? changes.color : current.color),
    ...optionalProperty("note", hasOwn(changes, "note") ? changes.note : current.note),
  };
}

function completeUpdate(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  book: StoredBookAnnotations,
  index: number,
  current: StoredBookmarkAnnotation,
  candidate: object,
  timestamp: string,
): AnnotationMetadataMutation<StoredBookmarkAnnotation>;
function completeUpdate(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  book: StoredBookAnnotations,
  index: number,
  current: StoredHighlightAnnotation,
  candidate: object,
  timestamp: string,
): AnnotationMetadataMutation<StoredHighlightAnnotation>;
function completeUpdate(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  book: StoredBookAnnotations,
  index: number,
  current: StoredAnnotationRecord,
  candidate: object,
  timestamp: string,
): AnnotationMetadataMutation<StoredAnnotationRecord> {
  const updated = normalizeAnnotationRecord(
    {
      ...candidate,
      id: current.id,
      type: current.type,
      createdAt: current.createdAt,
      updatedAt: timestamp,
    },
    bookId,
  );
  if (jsonValuesEqual({ ...current, updatedAt: updated.updatedAt }, updated)) {
    return unchanged(metadata, current);
  }

  const annotations = [...book.annotations];
  annotations[index] = updated;
  return changed(replaceBookAnnotations(metadata, bookId, { ...book, annotations }), updated);
}

function findAnnotation(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  annotationId: string,
): { book: StoredBookAnnotations; current: StoredAnnotationRecord; index: number } | undefined {
  const book = metadata.books[bookId];
  const index = book?.annotations.findIndex((annotation) => annotation.id === annotationId) ?? -1;
  if (!book || index < 0) return undefined;
  return { book, current: book.annotations[index], index };
}

export function updateBookmarkInMetadata(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  annotationId: string,
  changes: UpdateBookmarkAnnotationInput,
  timestamp: string,
): AnnotationMetadataMutation<StoredBookmarkAnnotation | undefined> {
  const target = findAnnotation(metadata, bookId, annotationId);
  if (!target) return unchanged(metadata, undefined);
  if (target.current.type !== "bookmark") {
    throw new Error(
      `Annotation ${JSON.stringify(annotationId)} is ${target.current.type}, not bookmark.`,
    );
  }

  return completeUpdate(
    metadata,
    bookId,
    target.book,
    target.index,
    target.current,
    bookmarkUpdateCandidate(target.current, changes),
    timestamp,
  );
}

export function updateHighlightInMetadata(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  annotationId: string,
  changes: UpdateHighlightAnnotationInput,
  timestamp: string,
): AnnotationMetadataMutation<StoredHighlightAnnotation | undefined> {
  const target = findAnnotation(metadata, bookId, annotationId);
  if (!target) return unchanged(metadata, undefined);
  if (target.current.type !== "highlight") {
    throw new Error(
      `Annotation ${JSON.stringify(annotationId)} is ${target.current.type}, not highlight.`,
    );
  }

  return completeUpdate(
    metadata,
    bookId,
    target.book,
    target.index,
    target.current,
    highlightUpdateCandidate(target.current, changes),
    timestamp,
  );
}

export function deleteAnnotationInMetadata(
  metadata: StoredAnnotationsMetadata,
  bookId: string,
  annotationId: string,
): AnnotationMetadataMutation<boolean> {
  const book = metadata.books[bookId];
  if (!book) return unchanged(metadata, false);

  const annotationIndex = book.annotations.findIndex(
    (annotation) => annotation.id === annotationId,
  );
  if (annotationIndex < 0) return unchanged(metadata, false);

  const nextAnnotations = book.annotations.filter((_, index) => index !== annotationIndex);
  const nextBooks = { ...metadata.books };
  const nextBook = { ...book, annotations: nextAnnotations };
  if (nextBook.annotations.length === 0 && !hasUnknownBookFields(nextBook)) {
    delete nextBooks[bookId];
  } else {
    nextBooks[bookId] = nextBook;
  }
  return changed({ ...metadata, books: nextBooks }, true);
}
