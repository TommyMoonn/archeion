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
import type { LibraryMetadata } from "../metadataFiles";
import {
  createAnnotationInMetadata,
  deleteAnnotationInMetadata,
  restoreAnnotationInMetadata,
  updateBookmarkInMetadata,
  updateHighlightInMetadata,
  type AnnotationMetadataMutation,
} from "./annotationMetadataMutations";
import {
  normalizeAnnotationsMetadata,
  type StoredAnnotationRecord,
  type StoredAnnotationsMetadata,
} from "./annotationsMetadata";

export type AnnotationArchiveScope = {
  generation: number;
  rootPath: string | null;
};

export type ArchiveAnnotationBook = {
  bookId: string;
  book: LibraryMetadata["books"][string] | undefined;
  annotations: Annotation[];
};

export type ArchiveAnnotationSnapshot = {
  activationRevision: number;
  books: ArchiveAnnotationBook[];
};

export type AnnotationMetadataSnapshot = { metadata: unknown; revision: string };

type AnnotationRepositoryHost = {
  createScope: () => AnnotationArchiveScope;
  assertCurrentScope: (scope: AnnotationArchiveScope) => void;
  runMetadataIo: <T>(
    scope: AnnotationArchiveScope,
    operation: () => Promise<T>,
  ) => Promise<T | undefined>;
  loadMetadata: (scope: AnnotationArchiveScope) => Promise<AnnotationMetadataSnapshot>;
  saveMetadata: (
    scope: AnnotationArchiveScope,
    metadata: StoredAnnotationsMetadata,
    expectedRevision: string,
  ) => Promise<string | null>;
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
  static snapshot(library: LibraryMetadata, raw: unknown): ArchiveAnnotationBook[] {
    return Object.entries(normalizeAnnotationsMetadata(raw).books).flatMap(
      ([bookId, { annotations }]) =>
        annotations.length
          ? [
              {
                bookId,
                book: Object.hasOwn(library.books, bookId) ? library.books[bookId] : undefined,
                annotations,
              },
            ]
          : [],
    );
  }

  private cache: {
    generation: number;
    metadata: StoredAnnotationsMetadata;
    revision: string;
  } | null = null;

  constructor(private readonly host: AnnotationRepositoryHost) {}

  reset(): void {
    this.cache = null;
  }

  async list(bookId: string): Promise<Annotation[]> {
    const normalizedBookId = normalizeBookId(bookId);
    return this.run(async (scope) => {
      const { metadata } = await this.load(scope);
      return cloneAnnotations(metadata.books[normalizedBookId]?.annotations ?? []);
    });
  }

  async get(bookId: string, annotationId: string): Promise<Annotation | undefined> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = normalizeAnnotationId(annotationId);
    if (!normalizedAnnotationId) return undefined;

    return this.run(async (scope) => {
      const { metadata } = await this.load(scope);
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
    const id = this.host.createId?.() ?? createAnnotationId();
    const timestamp = this.timestamp();
    const annotation = await this.mutate((metadata) =>
      createAnnotationInMetadata(metadata, normalizedBookId, input, id, timestamp),
    );
    return cloneAnnotation(annotation);
  }

  restore(bookId: string, annotation: BookmarkAnnotation): Promise<BookmarkAnnotation>;
  restore(bookId: string, annotation: HighlightAnnotation): Promise<HighlightAnnotation>;
  restore(bookId: string, annotation: Annotation): Promise<Annotation>;
  async restore(bookId: string, annotation: Annotation): Promise<Annotation> {
    const normalizedBookId = normalizeBookId(bookId);
    const restored = await this.mutate((metadata) =>
      restoreAnnotationInMetadata(metadata, normalizedBookId, annotation),
    );
    return cloneAnnotation(restored);
  }

  async updateBookmark(
    bookId: string,
    annotationId: string,
    changes: UpdateBookmarkAnnotationInput,
  ): Promise<BookmarkAnnotation | undefined> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = normalizeAnnotationId(annotationId);
    if (!normalizedAnnotationId) return undefined;

    const timestamp = this.timestamp();
    const annotation = await this.mutate((metadata) =>
      updateBookmarkInMetadata(
        metadata,
        normalizedBookId,
        normalizedAnnotationId,
        changes,
        timestamp,
      ),
    );
    return annotation ? structuredClone(annotation) : undefined;
  }

  async updateHighlight(
    bookId: string,
    annotationId: string,
    changes: UpdateHighlightAnnotationInput,
  ): Promise<HighlightAnnotation | undefined> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = normalizeAnnotationId(annotationId);
    if (!normalizedAnnotationId) return undefined;

    const timestamp = this.timestamp();
    const annotation = await this.mutate((metadata) =>
      updateHighlightInMetadata(
        metadata,
        normalizedBookId,
        normalizedAnnotationId,
        changes,
        timestamp,
      ),
    );
    return annotation ? structuredClone(annotation) : undefined;
  }

  async delete(bookId: string, annotationId: string): Promise<boolean> {
    const normalizedBookId = normalizeBookId(bookId);
    const normalizedAnnotationId = normalizeAnnotationId(annotationId);
    if (!normalizedAnnotationId) return false;

    return this.mutate((metadata) =>
      deleteAnnotationInMetadata(metadata, normalizedBookId, normalizedAnnotationId),
    );
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

  private async load(scope: AnnotationArchiveScope) {
    const { metadata, revision } = await this.host.loadMetadata(scope);
    this.host.assertCurrentScope(scope);
    this.cache = {
      generation: scope.generation,
      metadata: normalizeAnnotationsMetadata(metadata),
      revision,
    };
    return this.cache;
  }

  private mutate<T>(apply: (metadata: StoredAnnotationsMetadata) => AnnotationMetadataMutation<T>) {
    return this.run(async (scope) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const base =
          this.cache?.generation === scope.generation ? this.cache : await this.load(scope);
        const mutation = apply(base.metadata);
        if (!mutation.changed) return mutation.value;
        const revision = await this.host.saveMetadata(
          scope,
          structuredClone(mutation.metadata),
          base.revision,
        );
        this.host.assertCurrentScope(scope);
        if (revision !== null) {
          this.cache = { generation: scope.generation, metadata: mutation.metadata, revision };
          return mutation.value;
        }
        this.cache = null;
      }
      throw new Error("Annotations changed while saving. Try this action again.");
    });
  }
}
