import {
  ANNOTATION_TYPES,
  type Annotation,
  type AnnotationsMetadata,
  type CreateAnnotationInput,
  type UpdateAnnotationInput,
} from "../../types/annotation";
import {
  createAnnotationsMetadata,
  normalizeAnnotationNote,
  normalizeAnnotationRecord,
  normalizeAnnotationsMetadata,
} from "./annotationsMetadata";

export type AnnotationArchiveScope = {
  generation: number;
  rootPath: string | null;
};

type AnnotationRepositoryHost = {
  createScope: () => AnnotationArchiveScope;
  assertCurrentScope: (scope: AnnotationArchiveScope) => void;
  runMetadataIo: <T>(
    scope: AnnotationArchiveScope,
    operation: () => Promise<T>,
  ) => Promise<T | undefined>;
  loadMetadata: (scope: AnnotationArchiveScope) => Promise<unknown>;
  saveMetadata: (scope: AnnotationArchiveScope, metadata: AnnotationsMetadata) => Promise<void>;
  now?: () => string;
  createId?: () => string;
};

let fallbackIdCounter = 0;

function createAnnotationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  fallbackIdCounter += 1;
  return `annotation-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

function cloneAnnotation(annotation: Annotation): Annotation {
  return structuredClone(annotation);
}

function cloneAnnotations(annotations: readonly Annotation[]): Annotation[] {
  return annotations.map(cloneAnnotation);
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

function normalizeBookId(bookId: string): string {
  const normalized = bookId.trim();
  if (!normalized) {
    throw new Error("A book id is required for annotation storage.");
  }
  return normalized;
}

function hasUnknownBookFields(book: AnnotationsMetadata["books"][string]): boolean {
  return Object.keys(book).some((key) => key !== "annotations");
}

const OPTIONAL_TRIMMED_TEXT_FIELDS = [
  "cfiRange",
  "chapterHref",
  "selectedText",
  "contextBefore",
  "contextAfter",
  "color",
  "label",
] as const;

function normalizeOptionalTextFields<T extends Record<string, unknown>>(value: T): T {
  const next: Record<string, unknown> = { ...value };
  if (
    Object.prototype.hasOwnProperty.call(next, "anchorStatus") &&
    next.anchorStatus === undefined
  ) {
    delete next.anchorStatus;
  }
  for (const key of OPTIONAL_TRIMMED_TEXT_FIELDS) {
    const candidate = next[key];
    if (typeof candidate !== "string") {
      delete next[key];
      continue;
    }
    const normalized = candidate.trim();
    if (normalized) {
      next[key] = normalized;
    } else {
      delete next[key];
    }
  }

  if (Object.prototype.hasOwnProperty.call(next, "note")) {
    if (next.note === undefined) {
      delete next.note;
    } else if (typeof next.note === "string") {
      const note = normalizeAnnotationNote(next.note);
      if (note === undefined) {
        delete next.note;
      } else {
        next.note = note;
      }
    }
  }

  return next as T;
}

export class AnnotationRepository {
  private cachedGeneration: number | null = null;
  private metadata: AnnotationsMetadata = createAnnotationsMetadata();

  constructor(private readonly host: AnnotationRepositoryHost) {}

  reset(): void {
    this.cachedGeneration = null;
    this.metadata = createAnnotationsMetadata();
  }

  async list(bookId: string): Promise<Annotation[]> {
    const normalizedBookId = normalizeBookId(bookId);
    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      return cloneAnnotations(metadata.books[normalizedBookId]?.annotations ?? []);
    });
  }

  async get(bookId: string, annotationId: string): Promise<Annotation | undefined> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = annotationId.trim();
    if (!normalizedAnnotationId) {
      return undefined;
    }

    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const annotation = metadata.books[normalizedBookId]?.annotations.find(
        (candidate) => candidate.id === normalizedAnnotationId,
      );
      return annotation ? cloneAnnotation(annotation) : undefined;
    });
  }

  async create(bookId: string, input: CreateAnnotationInput): Promise<Annotation> {
    const normalizedBookId = normalizeBookId(bookId);
    if (!ANNOTATION_TYPES.includes(input.type)) {
      throw new Error(`Unsupported annotation type: ${String(input.type)}`);
    }

    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const timestamp = this.host.now?.() ?? new Date().toISOString();
      const annotation = normalizeAnnotationRecord(
        normalizeOptionalTextFields({
          ...input,
          id: this.host.createId?.() ?? createAnnotationId(),
          type: input.type,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
        normalizedBookId,
      );
      const existingBook = metadata.books[normalizedBookId];
      if (annotation.type === "bookmark" && annotation.cfiRange) {
        const existingBookmark = existingBook?.annotations.find(
          (candidate) =>
            candidate.type === "bookmark" && candidate.cfiRange === annotation.cfiRange,
        );
        if (existingBookmark) {
          return cloneAnnotation(existingBookmark);
        }
      }

      const next = structuredClone(metadata);
      const book = next.books[normalizedBookId] ?? { annotations: [] };
      if (book.annotations.some((candidate) => candidate.id === annotation.id)) {
        throw new Error(`Annotation id already exists: ${annotation.id}`);
      }
      next.books[normalizedBookId] = {
        ...book,
        annotations: [...book.annotations, annotation],
      };
      await this.persist(scope, next);
      return cloneAnnotation(annotation);
    });
  }

  async restore(bookId: string, annotation: Annotation): Promise<Annotation> {
    const normalizedBookId = normalizeBookId(bookId);
    const restored = normalizeAnnotationRecord(structuredClone(annotation), normalizedBookId);

    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const existingBook = metadata.books[normalizedBookId];
      const sameId = existingBook?.annotations.find((candidate) => candidate.id === restored.id);
      if (sameId) {
        if (jsonValuesEqual(sameId, restored)) {
          return cloneAnnotation(sameId);
        }
        throw new Error(
          `Annotation restore collision: id ${JSON.stringify(restored.id)} already exists in book ${JSON.stringify(normalizedBookId)}.`,
        );
      }

      if (restored.type === "bookmark" && restored.cfiRange) {
        const sameLocation = existingBook?.annotations.find(
          (candidate) => candidate.type === "bookmark" && candidate.cfiRange === restored.cfiRange,
        );
        if (sameLocation) {
          throw new Error(
            `Annotation restore collision: bookmark location already exists in book ${JSON.stringify(normalizedBookId)}.`,
          );
        }
      }

      const next = structuredClone(metadata);
      const book = next.books[normalizedBookId] ?? { annotations: [] };
      next.books[normalizedBookId] = {
        ...book,
        annotations: [...book.annotations, restored],
      };
      await this.persist(scope, next);
      return cloneAnnotation(restored);
    });
  }

  async update(
    bookId: string,
    annotationId: string,
    changes: UpdateAnnotationInput,
  ): Promise<Annotation | undefined> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = annotationId.trim();
    if (!normalizedAnnotationId) {
      return undefined;
    }

    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const annotations = metadata.books[normalizedBookId]?.annotations;
      const index = annotations?.findIndex(
        (annotation) => annotation.id === normalizedAnnotationId,
      );
      if (index === undefined || index < 0 || !annotations) {
        return undefined;
      }

      const current = annotations[index];
      const updated = normalizeAnnotationRecord(
        normalizeOptionalTextFields({
          ...current,
          ...changes,
          id: current.id,
          type: current.type,
          createdAt: current.createdAt,
          updatedAt: this.host.now?.() ?? new Date().toISOString(),
        }),
        normalizedBookId,
      );
      const next = structuredClone(metadata);
      next.books[normalizedBookId].annotations[index] = updated;
      await this.persist(scope, next);
      return cloneAnnotation(updated);
    });
  }

  async delete(bookId: string, annotationId: string): Promise<boolean> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = annotationId.trim();
    if (!normalizedAnnotationId) {
      return false;
    }

    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const book = metadata.books[normalizedBookId];
      if (!book) {
        return false;
      }

      const annotationIndex = book.annotations.findIndex(
        (annotation) => annotation.id === normalizedAnnotationId,
      );
      if (annotationIndex < 0) {
        return false;
      }

      const next = structuredClone(metadata);
      const nextBook = next.books[normalizedBookId];
      nextBook.annotations.splice(annotationIndex, 1);
      if (nextBook.annotations.length === 0 && !hasUnknownBookFields(nextBook)) {
        delete next.books[normalizedBookId];
      }
      await this.persist(scope, next);
      return true;
    });
  }

  private async run<T>(operation: (scope: AnnotationArchiveScope) => Promise<T>): Promise<T> {
    const scope = this.host.createScope();
    const result = await this.host.runMetadataIo(scope, async () => ({
      value: await operation(scope),
    }));
    this.host.assertCurrentScope(scope);
    if (!result) {
      throw new Error("The active archive changed before annotation storage completed.");
    }
    return result.value;
  }

  private async ensureLoaded(scope: AnnotationArchiveScope): Promise<AnnotationsMetadata> {
    if (this.cachedGeneration === scope.generation) {
      return this.metadata;
    }

    const raw = await this.host.loadMetadata(scope);
    this.host.assertCurrentScope(scope);
    this.metadata = normalizeAnnotationsMetadata(raw);
    this.cachedGeneration = scope.generation;
    return this.metadata;
  }

  private async persist(
    scope: AnnotationArchiveScope,
    metadata: AnnotationsMetadata,
  ): Promise<void> {
    const normalized = normalizeAnnotationsMetadata(metadata);
    await this.host.saveMetadata(scope, structuredClone(normalized));
    this.host.assertCurrentScope(scope);
    this.metadata = normalized;
    this.cachedGeneration = scope.generation;
  }
}
