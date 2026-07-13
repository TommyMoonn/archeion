import {
  ANNOTATION_TYPES,
  type Annotation,
  type AnnotationsMetadata,
  type AnnotationType,
  type BookmarkAnnotation,
  type BookAnnotations,
  type HighlightAnnotation,
} from "../../types/annotation";

const CURRENT_ANNOTATIONS_VERSION = 1;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const ROOT_KNOWN_FIELDS = new Set(["version", "books"]);
const BOOK_KNOWN_FIELDS = new Set(["annotations"]);
const ANNOTATION_KNOWN_FIELDS = new Set([
  "id",
  "type",
  "anchorStatus",
  "cfiRange",
  "chapterHref",
  "selectedText",
  "contextBefore",
  "contextAfter",
  "color",
  "note",
  "label",
  "createdAt",
  "updatedAt",
]);
type OptionalAnnotationTextField =
  | "cfiRange"
  | "chapterHref"
  | "selectedText"
  | "contextBefore"
  | "contextAfter"
  | "color"
  | "note"
  | "label";

export function normalizeAnnotationNote(note: string): string | undefined {
  return note.trim() ? note : undefined;
}

export class AnnotationMetadataValidationError extends Error {
  constructor(reason: string) {
    super(`Annotation metadata is invalid: ${reason}`);
    this.name = "AnnotationMetadataValidationError";
  }
}

function invalid(reason: string): never {
  throw new AnnotationMetadataValidationError(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function assertJsonCompatible(value: unknown, path: string, ancestors = new Set<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      invalid(`${path} contains a circular value.`);
    }
    const nextAncestors = new Set(ancestors).add(value);
    value.forEach((entry, index) =>
      assertJsonCompatible(entry, `${path}[${index}]`, nextAncestors),
    );
    return;
  }

  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid(`${path} must contain JSON-compatible values.`);
    }
    if (ancestors.has(value)) {
      invalid(`${path} contains a circular value.`);
    }
    const nextAncestors = new Set(ancestors).add(value);
    for (const [key, entry] of Object.entries(value)) {
      assertJsonCompatible(entry, `${path}.${key}`, nextAncestors);
    }
    return;
  }

  invalid(`${path} must contain JSON-compatible values.`);
}

function collectUnknownFields(
  value: Record<string, unknown>,
  knownFields: ReadonlySet<string>,
  context: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key, entry]) => {
      if (knownFields.has(key)) {
        return false;
      }
      assertJsonCompatible(entry, `${context}.${key}`);
      return true;
    }),
  );
}

function requiredString(value: Record<string, unknown>, key: string, context: string): string {
  if (!hasOwn(value, key)) {
    invalid(`${context} is missing ${key}.`);
  }
  if (typeof value[key] !== "string") {
    invalid(`${key} for ${context} must be a string.`);
  }
  const normalized = value[key].trim();
  if (!normalized) {
    invalid(`${key} for ${context} must not be empty.`);
  }
  return normalized;
}

function requiredTimestamp(
  value: Record<string, unknown>,
  key: "createdAt" | "updatedAt",
  context: string,
): string {
  const normalized = requiredString(value, key, context);
  const match = ISO_TIMESTAMP_PATTERN.exec(normalized);
  if (!match) {
    invalid(`${key} for ${context} must be a valid ISO timestamp.`);
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const daysInMonth =
    month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;

  if (
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    Number.isNaN(Date.parse(normalized))
  ) {
    invalid(`${key} for ${context} must be a valid ISO timestamp.`);
  }
  return normalized;
}

function optionalString(
  value: Record<string, unknown>,
  key: OptionalAnnotationTextField,
  context: string,
): string | undefined {
  if (!hasOwn(value, key)) {
    return undefined;
  }
  if (typeof value[key] !== "string") {
    invalid(`${key} for ${context} must be a string when present.`);
  }
  if (key === "note") {
    return normalizeAnnotationNote(value[key]);
  }
  const normalized = value[key].trim();
  return normalized || undefined;
}

function optionalAnchorStatus(
  value: Record<string, unknown>,
  context: string,
): "detached" | undefined {
  if (!hasOwn(value, "anchorStatus")) return undefined;
  if (value.anchorStatus !== "detached") {
    invalid(`anchorStatus for ${context} must be detached when present.`);
  }
  return "detached";
}

function isAnnotationType(value: unknown): value is AnnotationType {
  return typeof value === "string" && ANNOTATION_TYPES.includes(value as AnnotationType);
}

function normalizeAnnotation(value: unknown, bookId: string, annotationIndex: number): Annotation {
  const context = `annotation ${annotationIndex + 1} in book ${quoted(bookId)}`;
  if (!isRecord(value)) {
    invalid(`${context} must be an object.`);
  }

  const id = requiredString(value, "id", context);
  if (!hasOwn(value, "type")) {
    invalid(`${context} is missing type.`);
  }
  if (!isAnnotationType(value.type)) {
    invalid(`type for ${context} is not supported.`);
  }
  const createdAt = requiredTimestamp(value, "createdAt", context);
  const updatedAt = requiredTimestamp(value, "updatedAt", context);
  const unknownFields = collectUnknownFields(value, ANNOTATION_KNOWN_FIELDS, context);
  const anchorStatus = optionalAnchorStatus(value, context);
  const chapterHref = optionalString(value, "chapterHref", context);

  if (value.type === "bookmark") {
    for (const field of [
      "selectedText",
      "contextBefore",
      "contextAfter",
      "color",
      "note",
    ] as const) {
      if (hasOwn(value, field)) invalid(`${field} is not allowed for ${context} of type bookmark.`);
    }
    const label = optionalString(value, "label", context);
    const cfiRange = optionalString(value, "cfiRange", context);
    return {
      ...unknownFields,
      ...(anchorStatus ? { anchorStatus } : {}),
      id,
      type: "bookmark",
      ...(cfiRange ? { cfiRange } : {}),
      ...(chapterHref ? { chapterHref } : {}),
      ...(label ? { label } : {}),
      createdAt,
      updatedAt,
    } as BookmarkAnnotation;
  }

  if (hasOwn(value, "label")) {
    invalid(`label is not allowed for ${context} of type highlight.`);
  }
  const selectedText = requiredString(value, "selectedText", context);
  const cfiRange = requiredString(value, "cfiRange", context);
  const color = requiredString(value, "color", context);
  const contextBefore = optionalString(value, "contextBefore", context);
  const contextAfter = optionalString(value, "contextAfter", context);
  const note = optionalString(value, "note", context);
  return {
    ...unknownFields,
    ...(anchorStatus ? { anchorStatus } : {}),
    id,
    type: "highlight",
    cfiRange,
    ...(chapterHref ? { chapterHref } : {}),
    selectedText,
    ...(contextBefore ? { contextBefore } : {}),
    ...(contextAfter ? { contextAfter } : {}),
    color,
    ...(note ? { note } : {}),
    createdAt,
    updatedAt,
  } as HighlightAnnotation;
}

export function normalizeAnnotationRecord(value: unknown, bookId: string): Annotation {
  const normalizedBookId = bookId.trim();
  if (!normalizedBookId) {
    invalid("book id must not be empty.");
  }
  return normalizeAnnotation(value, normalizedBookId, 0);
}

function normalizeBookAnnotations(value: unknown, bookId: string): BookAnnotations {
  const context = `book ${quoted(bookId)}`;
  if (!isRecord(value)) {
    invalid(`${context} must be an object.`);
  }
  if (!hasOwn(value, "annotations")) {
    invalid(`${context} is missing annotations.`);
  }
  if (!Array.isArray(value.annotations)) {
    invalid(`annotations for ${context} must be an array.`);
  }

  const annotationIds = new Set<string>();
  const annotations = value.annotations.map((annotation, index) => {
    const normalized = normalizeAnnotation(annotation, bookId, index);
    if (annotationIds.has(normalized.id)) {
      invalid(`duplicate annotation id ${quoted(normalized.id)} in ${context}.`);
    }
    annotationIds.add(normalized.id);
    return normalized;
  });

  return {
    ...collectUnknownFields(value, BOOK_KNOWN_FIELDS, context),
    annotations,
  };
}

function readVersion(value: Record<string, unknown>): 0 | 1 {
  if (!hasOwn(value, "version")) {
    return 0;
  }
  if (!Number.isInteger(value.version)) {
    invalid("version must be an integer.");
  }
  if (value.version === 0 || value.version === CURRENT_ANNOTATIONS_VERSION) {
    return value.version;
  }
  invalid(`version ${String(value.version)} is not supported.`);
}

export function createAnnotationsMetadata(): AnnotationsMetadata {
  return { version: CURRENT_ANNOTATIONS_VERSION, books: {} };
}

export function normalizeAnnotationsMetadata(value: unknown): AnnotationsMetadata {
  if (!isRecord(value)) {
    invalid("root must be an object.");
  }

  readVersion(value);
  if (!hasOwn(value, "books")) {
    invalid("books is required.");
  }
  if (!isRecord(value.books)) {
    invalid("books must be an object.");
  }

  const books = Object.fromEntries(
    Object.entries(value.books).map(([bookId, bookAnnotations]) => {
      if (!bookId.trim()) {
        invalid("book ids must not be empty.");
      }
      return [bookId, normalizeBookAnnotations(bookAnnotations, bookId)];
    }),
  );

  return {
    ...collectUnknownFields(value, ROOT_KNOWN_FIELDS, "root"),
    version: CURRENT_ANNOTATIONS_VERSION,
    books,
  };
}
