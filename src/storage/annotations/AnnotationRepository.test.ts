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
        cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
        selectedText: " Passage ",
        color: "yellow",
      }),
    ).resolves.toMatchObject({
      id: "annotation-1",
      type: "highlight",
      selectedText: "Passage",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
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

  it("preserves note text exactly through create, update, reload, and restore", async () => {
    const originalNote = [
      "  opening indentation",
      "",
      "- Markdown item",
      "> Markdown quote",
      "    code-style indentation",
      "",
    ].join("\r\n");
    const updatedNote = `${originalNote}trailing line\n`;
    const harness = createHarness();
    const annotations = repository(harness);

    const created = await annotations.create("book-1", {
      type: "highlight",
      cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
      selectedText: "Passage",
      color: "yellow",
      note: originalNote,
    });
    if (created.type !== "highlight") throw new Error("Expected a highlight.");
    expect(created.note).toBe(originalNote);

    const updated = await annotations.update("book-1", created.id, { note: updatedNote });
    expect(updated?.note).toBe(updatedNote);
    expect((await annotations.list("book-1"))[0]?.note).toBe(updatedNote);

    annotations.reset();
    expect((await annotations.get("book-1", created.id))?.note).toBe(updatedNote);

    await annotations.delete("book-1", created.id);
    const restored = await annotations.restore("book-1", {
      ...created,
      note: originalNote,
    });
    expect(restored.note).toBe(originalNote);
    expect((await annotations.list("book-1"))[0]?.note).toBe(originalNote);
  });

  it("deletes only a highlight note while preserving the highlight", async () => {
    const harness = createHarness();
    const annotations = repository(harness);
    const created = await annotations.create("book-1", {
      type: "highlight",
      cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
      selectedText: "Passage",
      color: "rose",
      note: "Attached note",
    });

    const updated = await annotations.update("book-1", created.id, { note: undefined });

    expect(updated).toMatchObject({
      id: created.id,
      type: "highlight",
      cfiRange: created.cfiRange,
      selectedText: "Passage",
      color: "rose",
    });
    expect(updated).not.toHaveProperty("note");
    expect(await annotations.list("book-1")).toEqual([updated]);
  });

  it("marks and reanchors the same annotation while preserving authored and unknown fields", async () => {
    const harness = createHarness();
    const annotations = repository(harness);
    const created = await annotations.create("book-1", {
      type: "highlight",
      cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
      chapterHref: "Text/old.xhtml",
      selectedText: "Passage",
      contextBefore: "Before",
      contextAfter: "After",
      color: "rose",
      note: "Attached note",
    });
    const persisted = harness.persisted as AnnotationsMetadata;
    persisted.books["book-1"].annotations[0] = {
      ...created,
      futureAnchorMetadata: { preserved: true },
    } as never;
    harness.setPersisted(persisted);
    annotations.reset();

    const detached = await annotations.update("book-1", created.id, {
      anchorStatus: "detached",
    });
    const recovered = await annotations.update("book-1", created.id, {
      anchorStatus: undefined,
      cfiRange: "epubcfi(/6/4!/4/2:1,/4/2:2,/4/2:9)",
      chapterHref: "Text/new.xhtml",
    });

    expect(detached).toMatchObject({ anchorStatus: "detached", id: created.id });
    expect(recovered).toEqual({
      ...created,
      cfiRange: "epubcfi(/6/4!/4/2:1,/4/2:2,/4/2:9)",
      chapterHref: "Text/new.xhtml",
      futureAnchorMetadata: { preserved: true },
    });
    expect(recovered).not.toHaveProperty("anchorStatus");
    expect(await annotations.list("book-1")).toEqual([recovered]);
  });

  it("rejects non-string note input instead of silently discarding it", async () => {
    const harness = createHarness();
    const annotations = repository(harness);

    await expect(
      annotations.create("book-1", {
        type: "highlight",
        cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
        selectedText: "Passage",
        color: "yellow",
        note: null,
      } as never),
    ).rejects.toThrow("note for annotation 1");
    expect(harness.saveMetadata).not.toHaveBeenCalled();
  });

  it("rejects standalone notes and note fields on bookmarks", async () => {
    const harness = createHarness();
    const annotations = repository(harness);

    await expect(
      annotations.create("book-1", { type: "note", note: "Standalone" } as never),
    ).rejects.toThrow("type");
    await expect(
      annotations.create("book-1", { type: "bookmark", note: "Not allowed" } as never),
    ).rejects.toThrow("not allowed");
    expect(harness.saveMetadata).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: "highlight", selectedText: "Passage", color: "yellow" }, "cfiRange"],
    [
      {
        type: "highlight",
        cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
        selectedText: "   ",
        color: "yellow",
      },
      "selectedText",
    ],
    [
      {
        type: "highlight",
        cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
        selectedText: "Passage",
      },
      "color",
    ],
  ])("rejects incomplete highlight creation %#", async (input, field) => {
    const harness = createHarness();

    await expect(repository(harness).create("book-1", input as never)).rejects.toThrow(field);
    expect(harness.saveMetadata).not.toHaveBeenCalled();
  });

  it("rejects adding a note to an existing bookmark", async () => {
    const harness = createHarness();
    const annotations = repository(harness);
    const bookmark = await annotations.create("book-1", { type: "bookmark" });
    harness.saveMetadata.mockClear();

    await expect(
      annotations.update("book-1", bookmark.id, { note: "Not allowed" } as never),
    ).rejects.toThrow("not allowed");
    expect(harness.saveMetadata).not.toHaveBeenCalled();
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
      }),
    ).resolves.toMatchObject({
      id: "annotation-1",
      type: "bookmark",
      label: "Updated label",
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
              type: "highlight",
              cfiRange: "epubcfi(/6/4!/4/2:1,/4/2:1,/4/2:4)",
              selectedText: "Keep this",
              color: "yellow",
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
                type: "bookmark",
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
              type: "bookmark",
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
              type: "highlight",
              cfiRange: "epubcfi(/6/2!/4/2:1,/4/2:1,/4/2:4)",
              selectedText: "Passage",
              color: "yellow",
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

  it("restores the complete annotation without changing identity or unknown fields", async () => {
    const harness = createHarness({
      version: 1,
      futureTopLevel: { preserve: true },
      books: {
        "book-1": {
          annotations: [],
          futureBookField: { preserve: true },
        },
      },
    });
    const annotations = repository(harness);
    const original = {
      id: "highlight-1",
      type: "highlight" as const,
      cfiRange: "epubcfi(/6/2!/4/2:10)",
      chapterHref: "Text/chapter-1.xhtml",
      note: "Remember this",
      color: "yellow",
      selectedText: "Quoted passage",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      futureField: { nested: ["preserve-me"] },
    };

    const restored = await annotations.restore("book-1", original);
    expect(restored).toEqual(original);

    original.futureField.nested.push("mutated-input");
    (restored as unknown as Record<string, unknown>).futureField = { mutated: true };
    await expect(annotations.list("book-1")).resolves.toMatchObject([
      { futureField: { nested: ["preserve-me"] } },
    ]);

    expect(harness.persisted).toEqual({
      version: 1,
      futureTopLevel: { preserve: true },
      books: {
        "book-1": {
          annotations: [
            {
              id: "highlight-1",
              type: "highlight",
              cfiRange: "epubcfi(/6/2!/4/2:10)",
              chapterHref: "Text/chapter-1.xhtml",
              note: "Remember this",
              color: "yellow",
              selectedText: "Quoted passage",
              createdAt: "2026-07-10T00:00:00.000Z",
              updatedAt: "2026-07-11T00:00:00.000Z",
              futureField: { nested: ["preserve-me"] },
            },
          ],
          futureBookField: { preserve: true },
        },
      },
    });
    expect(harness.saveMetadata).toHaveBeenCalledTimes(1);
  });

  it("treats an equivalent same-id restore as idempotent without saving", async () => {
    const original = {
      id: "bookmark-1",
      type: "bookmark" as const,
      cfiRange: "epubcfi(/6/2!/4/2:10)",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      futureField: { nested: true },
    };
    const harness = createHarness({
      version: 1,
      books: { "book-1": { annotations: [original] } },
    });
    const annotations = repository(harness);

    await expect(annotations.restore("book-1", structuredClone(original))).resolves.toEqual(
      original,
    );
    expect(harness.saveMetadata).not.toHaveBeenCalled();
  });

  it("rejects conflicting same-id restoration without changing cached metadata", async () => {
    const stored = {
      id: "bookmark-1",
      type: "bookmark" as const,
      cfiRange: "epubcfi(/6/2!/4/2:10)",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    };
    const harness = createHarness({
      version: 1,
      books: { "book-1": { annotations: [stored] } },
    });
    const annotations = repository(harness);

    await expect(
      annotations.restore("book-1", { ...stored, label: "Conflicting content" }),
    ).rejects.toThrow('Annotation restore collision: id "bookmark-1" already exists');

    expect(harness.saveMetadata).not.toHaveBeenCalled();
    await expect(annotations.list("book-1")).resolves.toEqual([stored]);
  });

  it("rejects a different-id bookmark at the same CFI", async () => {
    const stored = {
      id: "bookmark-existing",
      type: "bookmark" as const,
      cfiRange: "epubcfi(/6/2!/4/2:10)",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    };
    const harness = createHarness({
      version: 1,
      books: { "book-1": { annotations: [stored] } },
    });
    const annotations = repository(harness);

    await expect(
      annotations.restore("book-1", { ...stored, id: "bookmark-restored" }),
    ).rejects.toThrow("bookmark location already exists");
    expect(harness.saveMetadata).not.toHaveBeenCalled();
  });

  it("keeps the previous repository state when restore persistence fails", async () => {
    const harness = createHarness();
    const annotations = repository(harness);
    harness.saveMetadata.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      annotations.restore("book-1", {
        id: "bookmark-1",
        type: "bookmark",
        cfiRange: "epubcfi(/6/2!/4/2:10)",
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      }),
    ).rejects.toThrow("disk full");

    await expect(annotations.list("book-1")).resolves.toEqual([]);
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
  it("does not create duplicate bookmarks for the same resolved CFI", async () => {
    const harness = createHarness();
    const annotations = repository(harness);

    const first = await annotations.create("book-1", {
      type: "bookmark",
      cfiRange: "epubcfi(/6/2!/4/2:10)",
      label: "First",
    });
    const duplicate = await annotations.create("book-1", {
      type: "bookmark",
      cfiRange: "epubcfi(/6/2!/4/2:10)",
      label: "Duplicate",
    });

    expect(duplicate).toEqual(first);
    await expect(annotations.list("book-1")).resolves.toEqual([first]);
    expect(harness.saveMetadata).toHaveBeenCalledTimes(1);
  });
});
