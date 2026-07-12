import {
  ANNOTATION_TYPES,
  type Annotation,
  type AnnotationsMetadata,
  type CreateAnnotationInput,
  type UpdateAnnotationInput,
} from "../../types/annotation";
import { createAnnotationsMetadata, normalizeAnnotationsMetadata } from "./annotationsMetadata";

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

const OPTIONAL_TEXT_FIELDS = [
  "cfiRange",
  "chapterHref",
  "selectedText",
  "contextBefore",
  "contextAfter",
  "color",
  "note",
  "label",
] as const;

function normalizeOptionalTextFields<T extends Record<string, unknown>>(value: T): T {
  const next: Record<string, unknown> = { ...value };
  for (const key of OPTIONAL_TEXT_FIELDS) {
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
      const annotation = normalizeOptionalTextFields({
        ...input,
        id: this.host.createId?.() ?? createAnnotationId(),
        type: input.type,
        createdAt: timestamp,
        updatedAt: timestamp,
      }) as Annotation;
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
      const updated = normalizeOptionalTextFields({
        ...current,
        ...changes,
        id: current.id,
        type: current.type,
        createdAt: current.createdAt,
        updatedAt: this.host.now?.() ?? new Date().toISOString(),
      }) as Annotation;
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
