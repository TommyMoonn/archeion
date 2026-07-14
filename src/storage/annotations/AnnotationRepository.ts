import type {
  Annotation,
  BookmarkAnnotation,
  CreateAnnotationInput,
  CreateBookmarkAnnotationInput,
  CreateHighlightAnnotationInput,
  HighlightAnnotation,
  UpdateBookmarkAnnotationInput,
  UpdateHighlightAnnotationInput,
} from "../../types/annotation";
import {
  createAnnotationInMetadata,
  deleteAnnotationInMetadata,
  restoreAnnotationInMetadata,
  updateBookmarkInMetadata,
  updateHighlightInMetadata,
} from "./annotationMetadataMutations";
import {
  createAnnotationsMetadata,
  normalizeAnnotationsMetadata,
  type StoredAnnotationRecord,
  type StoredAnnotationsMetadata,
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
  saveMetadata: (
    scope: AnnotationArchiveScope,
    metadata: StoredAnnotationsMetadata,
  ) => Promise<void>;
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

function cloneAnnotation(annotation: StoredAnnotationRecord | Annotation): Annotation {
  return structuredClone(annotation);
}

function cloneAnnotations(annotations: readonly StoredAnnotationRecord[]): Annotation[] {
  return annotations.map(cloneAnnotation);
}

function normalizeBookId(bookId: string): string {
  const normalized = bookId.trim();
  if (!normalized) {
    throw new Error("A book id is required for annotation storage.");
  }
  return normalized;
}

function normalizeAnnotationId(annotationId: string): string | undefined {
  return annotationId.trim() || undefined;
}

export class AnnotationRepository {
  private cachedGeneration: number | null = null;
  private metadata: StoredAnnotationsMetadata = createAnnotationsMetadata();

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
    const normalizedAnnotationId = normalizeAnnotationId(annotationId);
    if (!normalizedAnnotationId) return undefined;

    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const annotation = metadata.books[normalizedBookId]?.annotations.find(
        (candidate) => candidate.id === normalizedAnnotationId,
      );
      return annotation ? cloneAnnotation(annotation) : undefined;
    });
  }

  create(bookId: string, input: CreateBookmarkAnnotationInput): Promise<BookmarkAnnotation>;
  create(bookId: string, input: CreateHighlightAnnotationInput): Promise<HighlightAnnotation>;
  create(bookId: string, input: CreateAnnotationInput): Promise<Annotation>;
  async create(bookId: string, input: CreateAnnotationInput): Promise<Annotation> {
    const normalizedBookId = normalizeBookId(bookId);
    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const timestamp = this.timestamp();
      const mutation = createAnnotationInMetadata(
        metadata,
        normalizedBookId,
        input,
        this.host.createId?.() ?? createAnnotationId(),
        timestamp,
      );
      if (mutation.changed) await this.persist(scope, mutation.metadata);
      return cloneAnnotation(mutation.value);
    });
  }

  restore(bookId: string, annotation: BookmarkAnnotation): Promise<BookmarkAnnotation>;
  restore(bookId: string, annotation: HighlightAnnotation): Promise<HighlightAnnotation>;
  restore(bookId: string, annotation: Annotation): Promise<Annotation>;
  async restore(bookId: string, annotation: Annotation): Promise<Annotation> {
    const normalizedBookId = normalizeBookId(bookId);
    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const mutation = restoreAnnotationInMetadata(metadata, normalizedBookId, annotation);
      if (mutation.changed) await this.persist(scope, mutation.metadata);
      return cloneAnnotation(mutation.value);
    });
  }

  async updateBookmark(
    bookId: string,
    annotationId: string,
    changes: UpdateBookmarkAnnotationInput,
  ): Promise<BookmarkAnnotation | undefined> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = normalizeAnnotationId(annotationId);
    if (!normalizedAnnotationId) return undefined;

    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const mutation = updateBookmarkInMetadata(
        metadata,
        normalizedBookId,
        normalizedAnnotationId,
        changes,
        this.timestamp(),
      );
      if (mutation.changed) await this.persist(scope, mutation.metadata);
      return mutation.value ? (cloneAnnotation(mutation.value) as BookmarkAnnotation) : undefined;
    });
  }

  async updateHighlight(
    bookId: string,
    annotationId: string,
    changes: UpdateHighlightAnnotationInput,
  ): Promise<HighlightAnnotation | undefined> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = normalizeAnnotationId(annotationId);
    if (!normalizedAnnotationId) return undefined;

    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const mutation = updateHighlightInMetadata(
        metadata,
        normalizedBookId,
        normalizedAnnotationId,
        changes,
        this.timestamp(),
      );
      if (mutation.changed) await this.persist(scope, mutation.metadata);
      return mutation.value ? (cloneAnnotation(mutation.value) as HighlightAnnotation) : undefined;
    });
  }

  async delete(bookId: string, annotationId: string): Promise<boolean> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = normalizeAnnotationId(annotationId);
    if (!normalizedAnnotationId) return false;

    return this.run(async (scope) => {
      const metadata = await this.ensureLoaded(scope);
      const mutation = deleteAnnotationInMetadata(
        metadata,
        normalizedBookId,
        normalizedAnnotationId,
      );
      if (mutation.changed) await this.persist(scope, mutation.metadata);
      return mutation.value;
    });
  }

  private timestamp(): string {
    return this.host.now?.() ?? new Date().toISOString();
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

  private async ensureLoaded(scope: AnnotationArchiveScope): Promise<StoredAnnotationsMetadata> {
    if (this.cachedGeneration === scope.generation) return this.metadata;

    const raw = await this.host.loadMetadata(scope);
    this.host.assertCurrentScope(scope);
    this.metadata = normalizeAnnotationsMetadata(raw);
    this.cachedGeneration = scope.generation;
    return this.metadata;
  }

  private async persist(
    scope: AnnotationArchiveScope,
    metadata: StoredAnnotationsMetadata,
  ): Promise<void> {
    await this.host.saveMetadata(scope, structuredClone(metadata));
    this.host.assertCurrentScope(scope);
    this.metadata = metadata;
    this.cachedGeneration = scope.generation;
  }
}
