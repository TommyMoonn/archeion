import EpubCFI from "epubjs/src/epubcfi.js";
import { MAX_HIGHLIGHT_TEXT_LENGTH } from "../../types/annotation";
import type { LibraryMetadata } from "../metadataFiles";
import {
  READER_ANNOTATION_EXPORT_SCHEMA,
  READER_ANNOTATION_EXPORT_VERSION,
} from "./annotationExportFormat";
import { jsonValuesEqual } from "./annotationMetadataMutations";
import {
  normalizeAnnotationRecord,
  normalizeAnnotationsMetadata,
  isRecord,
  requiredTimestamp,
  type StoredAnnotationRecord,
} from "./annotationsMetadata";

type ImportBook = { id: string; annotations: StoredAnnotationRecord[] };

export type AnnotationImportSummary = {
  matchedBooks: number;
  importable: number;
  alreadyPresent: number;
  conflicts: number;
  unmatchedBookIds: string[];
};

export type AnnotationImportBatch = {
  activationRevision: number;
  annotationRevision: string;
  bookMatches: Record<string, boolean>;
  additions: Record<string, StoredAnnotationRecord[]>;
};

const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const MAX_FIELD_DEPTH = 32;
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

function checkUnicode(value: string): void {
  if (LONE_SURROGATE.test(value)) {
    throw new Error("The annotation export contains invalid Unicode text.");
  }
}

function record(value: unknown, description: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${description} must be an object.`);
  }
  return value;
}

function text(value: unknown, description: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${description} must be nonempty text.`);
  }
  checkUnicode(value);
  return value;
}

function checkAnnotationFields(value: unknown, depth: number): void {
  if (depth > MAX_FIELD_DEPTH) throw new Error("An annotation contains too many nested fields.");
  if (typeof value === "string") {
    checkUnicode(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      checkUnicode(key);
      checkAnnotationFields(entry, depth + 1);
    }
  }
}

function importAnnotation(value: unknown, bookId: string): StoredAnnotationRecord {
  const input = record(value, "Annotation");
  checkAnnotationFields(input, 0);
  const normalized = normalizeAnnotationRecord(input, bookId);
  if (
    normalized.type === "highlight" &&
    normalized.selectedText.length > MAX_HIGHLIGHT_TEXT_LENGTH
  ) {
    throw new Error(`Highlighted text exceeds ${MAX_HIGHLIGHT_TEXT_LENGTH} characters.`);
  }
  return normalized;
}

function preserveRecoverableAnchor(annotation: StoredAnnotationRecord): StoredAnnotationRecord {
  if (annotation.anchorStatus === "detached" || !annotation.cfiRange) return annotation;
  try {
    const cfi = new EpubCFI(annotation.cfiRange);
    if (
      annotation.cfiRange.includes("!") &&
      Number.isSafeInteger(cfi.spinePos) &&
      cfi.spinePos >= 0 &&
      (annotation.type === "bookmark" || cfi.range)
    ) {
      return annotation;
    }
  } catch {
    // Saved text and location hints still let the Reader attempt recovery.
  }
  return { ...annotation, anchorStatus: "detached" };
}

export function parseAnnotationImport(bytes: ArrayBuffer): ImportBook[] {
  if (bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new Error("The annotation export exceeds the 64 MiB limit.");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("The annotation export is empty or contains invalid UTF-8 JSON.");
  }
  const document = record(json, "The annotation export");
  if (document.schema !== READER_ANNOTATION_EXPORT_SCHEMA) {
    throw new Error("Choose an Archeion annotation export.");
  }
  if (document.version !== READER_ANNOTATION_EXPORT_VERSION) {
    throw new Error("This annotation export version is unsupported.");
  }
  requiredTimestamp(document, "exportedAt", "the annotation export");
  if (!Array.isArray(document.books) || document.books.length === 0) {
    throw new Error("The annotation export must contain at least one book.");
  }
  const bookIds = new Set<string>();
  return document.books.map((entry: unknown) => {
    const book = record(entry, "An exported book");
    const id = text(book.id, "Book ID");
    if (bookIds.has(id)) throw new Error("The annotation export contains a duplicate book ID.");
    bookIds.add(id);
    text(book.title, "Book title");
    if (Object.hasOwn(book, "author")) text(book.author, "Book author");
    if (!Array.isArray(book.annotations) || book.annotations.length === 0) {
      throw new Error("Each exported book must contain annotations.");
    }
    const annotationIds = new Set<string>();
    const annotations = book.annotations.map((item: unknown) => {
      const entry = record(item, "An exported annotation");
      text(entry.chapterLabel, "Chapter label");
      const annotation = importAnnotation(entry.annotation, id);
      if (annotationIds.has(annotation.id)) {
        throw new Error("An exported book contains a duplicate annotation ID.");
      }
      annotationIds.add(annotation.id);
      return annotation;
    });
    return { id, annotations };
  });
}

export function previewAnnotationImport(
  books: readonly ImportBook[],
  snapshot: {
    activationRevision: number;
    annotationRevision: string;
    annotations: unknown;
    library: LibraryMetadata;
  },
): { summary: AnnotationImportSummary; batch: AnnotationImportBatch } {
  const current = normalizeAnnotationsMetadata(snapshot.annotations);
  const summary: AnnotationImportSummary = {
    matchedBooks: 0,
    importable: 0,
    alreadyPresent: 0,
    conflicts: 0,
    unmatchedBookIds: [],
  };
  const bookMatches = new Map<string, boolean>();
  const additions = new Map<string, StoredAnnotationRecord[]>();
  for (const book of books) {
    const matched = Object.hasOwn(snapshot.library.books, book.id);
    bookMatches.set(book.id, matched);
    if (!matched) {
      summary.unmatchedBookIds.push(book.id);
      continue;
    }
    summary.matchedBooks += 1;
    const annotations = Object.hasOwn(current.books, book.id)
      ? current.books[book.id].annotations
      : [];
    const existing = new Map(annotations.map((annotation) => [annotation.id, annotation]));
    const candidates: StoredAnnotationRecord[] = [];
    for (const source of book.annotations) {
      const annotation = preserveRecoverableAnchor(source);
      const stored = existing.get(annotation.id);
      if (!stored) {
        candidates.push(annotation);
        summary.importable += 1;
      } else if (jsonValuesEqual(stored, source) || jsonValuesEqual(stored, annotation)) {
        summary.alreadyPresent += 1;
      } else {
        summary.conflicts += 1;
      }
    }
    if (candidates.length > 0) additions.set(book.id, candidates);
  }
  return {
    summary,
    batch: {
      activationRevision: snapshot.activationRevision,
      annotationRevision: snapshot.annotationRevision,
      bookMatches: Object.fromEntries(bookMatches),
      additions: Object.fromEntries(additions),
    },
  };
}
