import { describe, expect, it, vi } from "vitest";

import type { AnnotationsMetadata } from "../../types/annotation";
import { AnnotationRepository, type AnnotationArchiveScope } from "./AnnotationRepository";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

type Harness = ReturnType<typeof createHarness>;

function createHarness(initial: unknown = { version: 1, books: {} }) {
  let generation = 1;
  let persisted = structuredClone(initial);
  let queue: Promise<void> = Promise.resolve();
  const loadMetadata = vi.fn(async () => structuredClone(persisted));
  const saveMetadata = vi.fn(async (_scope: AnnotationArchiveScope, value: AnnotationsMetadata) => {
    persisted = structuredClone(value);
  });
  const host = {
    createScope: (): AnnotationArchiveScope => ({ generation, rootPath: `archive-${generation}` }),
    assertCurrentScope: (scope: AnnotationArchiveScope) => {
      if (scope.generation !== generation) {
        throw new Error("The active archive changed before annotation storage completed.");
      }
    },
    runMetadataIo: <T>(scope: AnnotationArchiveScope, operation: () => Promise<T>) => {
      const pending = queue.then(async () => {
        if (scope.generation !== generation) {
          return undefined;
        }
        return operation();
      });
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    loadMetadata,
    saveMetadata,
    now: () => "2026-07-12T00:00:00.000Z",
    createId: () => "annotation-1",
  };

  return {
    host,
    loadMetadata,
    saveMetadata,
    get persisted() {
      return structuredClone(persisted);
    },
    setPersisted(value: unknown) {
      persisted = structuredClone(value);
    },
    switchArchive() {
      generation += 1;
    },
  };
}

function repository(harness: Harness): AnnotationRepository {
  return new AnnotationRepository(harness.host);
}

describe("AnnotationRepository", () => {
  it("loads an empty repository without writing it", async () => {
    const harness = createHarness();

    await expect(repository(harness).list("book-1")).resolves.toEqual([]);

    expect(harness.loadMetadata).toHaveBeenCalledTimes(1);
    expect(harness.saveMetadata).not.toHaveBeenCalled();
  });

  it("creates stable records and preserves unknown metadata fields", async () => {
    const harness = createHarness({
      version: 1,
      books: {},
      futureTopLevel: { preserved: true },
    });
    const annotations = repository(harness);

    await expect(
      annotations.create("book-1", {
        type: "highlight",
        selectedText: " Passage ",
        futureAnnotationField: { preserved: true },
      }),
    ).resolves.toMatchObject({
      id: "annotation-1",
      type: "highlight",
      selectedText: "Passage",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
      futureAnnotationField: { preserved: true },
    });

    expect(harness.persisted).toMatchObject({
      futureTopLevel: { preserved: true },
      books: {
        "book-1": {
          annotations: [{ id: "annotation-1" }],
        },
      },
    });
  });

  it("returns undefined for missing records without treating it as a stale queue result", async () => {
    const harness = createHarness();
    const annotations = repository(harness);

    await expect(annotations.get("book-1", "missing")).resolves.toBeUndefined();
    await expect(
      annotations.update("book-1", "missing", { note: "Not present" }),
    ).resolves.toBeUndefined();
    await expect(annotations.delete("book-1", "missing")).resolves.toBe(false);
  });

  it("updates and deletes annotations without changing stable identity", async () => {
    const harness = createHarness();
    const annotations = repository(harness);
    await annotations.create("book-1", { type: "bookmark", label: "Chapter start" });

    await expect(
      annotations.update("book-1", "annotation-1", {
        label: "Updated label",
        note: "Remember this",
        id: "replacement-id",
        type: "highlight",
      }),
    ).resolves.toMatchObject({
      id: "annotation-1",
      type: "bookmark",
      label: "Updated label",
      note: "Remember this",
    });
    await expect(annotations.delete("book-1", "annotation-1")).resolves.toBe(true);
    await expect(annotations.list("book-1")).resolves.toEqual([]);
    expect(harness.persisted).toEqual({ version: 1, books: {} });
  });

  it("removes a book entry after deleting its final annotation when no unknown fields remain", async () => {
    const harness = createHarness({
      version: 1,
      books: {
        "book-1": {
          annotations: [
            {
              id: "annotation-1",
              type: "bookmark",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ],
        },
      },
    });

    await expect(repository(harness).delete("book-1", "annotation-1")).resolves.toBe(true);

    expect(harness.persisted).toEqual({ version: 1, books: {} });
  });

  it("preserves an unknown book-level string after deleting the final annotation", async () => {
    const harness = createHarness({
      version: 1,
      books: {
        "book-1": {
          annotations: [
            {
              id: "annotation-1",
              type: "bookmark",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ],
          futureBookField: "preserve-me",
        },
      },
    });

    await repository(harness).delete("book-1", "annotation-1");

    expect(harness.persisted).toEqual({
      version: 1,
      books: {
        "book-1": {
          annotations: [],
          futureBookField: "preserve-me",
        },
      },
    });
  });

  it("preserves an unknown nested book object after deleting the final annotation", async () => {
    const futureBookField = { readingSession: { id: "session-1", page: 12 } };
    const harness = createHarness({
      version: 1,
      books: {
        "book-1": {
          annotations: [
            {
              id: "annotation-1",
              type: "bookmark",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ],
          futureBookField,
        },
      },
    });

    await repository(harness).delete("book-1", "annotation-1");

    expect(harness.persisted).toMatchObject({
      books: {
        "book-1": {
          annotations: [],
          futureBookField,
        },
      },
    });
  });

  it("preserves multiple unknown book fields and top-level fields after final deletion", async () => {
    const harness = createHarness({
      version: 1,
      futureTopLevel: { preserve: true },
      books: {
        "book-1": {
          annotations: [
            {
              id: "annotation-1",
              type: "bookmark",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ],
          futureBookField: "preserve-me",
          futureBookObject: { nested: true },
        },
      },
    });

    await repository(harness).delete("book-1", "annotation-1");

    expect(harness.persisted).toEqual({
      version: 1,
      futureTopLevel: { preserve: true },
      books: {
        "book-1": {
          annotations: [],
          futureBookField: "preserve-me",
          futureBookObject: { nested: true },
        },
      },
    });
  });

  it("preserves remaining annotations and unknown fields after a partial deletion", async () => {
    const harness = createHarness({
      version: 1,
      books: {
        "book-1": {
          annotations: [
            {
              id: "annotation-1",
              type: "bookmark",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
            {
              id: "annotation-2",
              type: "note",
              note: "Keep this",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ],
          futureBookField: { preserve: true },
        },
      },
    });

    await repository(harness).delete("book-1", "annotation-1");

    expect(harness.persisted).toMatchObject({
      books: {
        "book-1": {
          annotations: [{ id: "annotation-2", note: "Keep this" }],
          futureBookField: { preserve: true },
        },
      },
    });
  });

  it("keeps in-memory state unchanged when a save fails", async () => {
    const harness = createHarness();
    const annotations = repository(harness);
    harness.saveMetadata.mockRejectedValueOnce(new Error("disk full"));

    await expect(annotations.create("book-1", { type: "bookmark" })).rejects.toThrow("disk full");
    await expect(annotations.list("book-1")).resolves.toEqual([]);
  });

  it.each([
    ["invalid root", null],
    ["invalid books", { version: 1, books: [] }],
    [
      "invalid annotation",
      {
        version: 1,
        books: {
          "book-1": {
            annotations: [{ id: "damaged" }],
          },
        },
      },
    ],
    [
      "duplicate annotation ids",
      {
        version: 1,
        books: {
          "book-1": {
            annotations: [
              {
                id: "duplicate",
                type: "bookmark",
                createdAt: "2026-07-12T00:00:00.000Z",
                updatedAt: "2026-07-12T00:00:00.000Z",
              },
              {
                id: "duplicate",
                type: "note",
                createdAt: "2026-07-12T00:00:00.000Z",
                updatedAt: "2026-07-12T00:00:00.000Z",
              },
            ],
          },
        },
      },
    ],
  ])("does not save or replace durable data after %s load failure", async (_label, initial) => {
    const harness = createHarness(initial);
    const annotations = repository(harness);
    const before = harness.persisted;

    await expect(annotations.create("book-1", { type: "bookmark" })).rejects.toThrow(
      "Annotation metadata is invalid:",
    );

    expect(harness.saveMetadata).not.toHaveBeenCalled();
    expect(harness.persisted).toEqual(before);
  });

  it("does not update or delete after duplicate-id validation fails", async () => {
    const harness = createHarness({
      version: 1,
      books: {
        "book-1": {
          annotations: [
            {
              id: "duplicate",
              type: "bookmark",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
            {
              id: "duplicate",
              type: "note",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ],
        },
      },
    });
    const annotations = repository(harness);

    await expect(
      annotations.update("book-1", "duplicate", { note: "Must not be applied" }),
    ).rejects.toThrow('duplicate annotation id "duplicate" in book "book-1"');
    await expect(annotations.delete("book-1", "duplicate")).rejects.toThrow(
      'duplicate annotation id "duplicate" in book "book-1"',
    );

    expect(harness.saveMetadata).not.toHaveBeenCalled();
  });

  it("can load corrected metadata after a validation failure without retaining an empty cache", async () => {
    const harness = createHarness({ version: 1, books: { "book-1": {} } });
    const annotations = repository(harness);

    await expect(annotations.list("book-1")).rejects.toThrow("is missing annotations");

    harness.setPersisted({
      version: 1,
      books: {
        "book-1": {
          annotations: [
            {
              id: "annotation-1",
              type: "bookmark",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ],
        },
      },
    });

    await expect(annotations.list("book-1")).resolves.toMatchObject([{ id: "annotation-1" }]);
    expect(harness.saveMetadata).not.toHaveBeenCalled();
  });

  it("serializes concurrent mutations through the metadata queue", async () => {
    const harness = createHarness();
    const annotations = repository(harness);
    let id = 0;
    harness.host.createId = () => `annotation-${++id}`;

    await Promise.all([
      annotations.create("book-1", { type: "bookmark", label: "First" }),
      annotations.create("book-1", { type: "bookmark", label: "Second" }),
    ]);

    await expect(annotations.list("book-1")).resolves.toHaveLength(2);
    expect(harness.saveMetadata).toHaveBeenCalledTimes(2);
  });

  it("rejects stale completion after an archive switch", async () => {
    const harness = createHarness();
    const pendingLoad = deferred<unknown>();
    harness.loadMetadata.mockReturnValueOnce(pendingLoad.promise);
    const annotations = repository(harness);

    const list = annotations.list("book-1");
    harness.switchArchive();
    pendingLoad.resolve({ version: 1, books: {} });

    await expect(list).rejects.toThrow("active archive changed");
    expect(harness.saveMetadata).not.toHaveBeenCalled();
  });

  it("loads the new archive after reset instead of reusing the old cache", async () => {
    const harness = createHarness({
      version: 1,
      books: { "book-1": { annotations: [] } },
    });
    const annotations = repository(harness);
    await annotations.list("book-1");

    harness.switchArchive();
    annotations.reset();
    await annotations.list("book-2");

    expect(harness.loadMetadata).toHaveBeenCalledTimes(2);
  });
});
