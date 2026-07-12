import { beforeEach, describe, expect, it } from "vitest";

import {
  deferred,
  expectCommandRootPath,
  invokeMock,
  scopedStorage,
  setupDefaultStorageMock,
} from "./tauri/storageTestSupport";

describe("TauriArchiveLibraryStorage annotations", () => {
  beforeEach(setupDefaultStorageMock);

  it("loads missing annotation metadata without creating a file", async () => {
    const { rootPath, storage } = await scopedStorage();
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_annotations_metadata") {
        return { version: 1, books: {} };
      }
      return undefined;
    });

    await expect(storage.listAnnotations("book-1")).resolves.toEqual([]);

    expectCommandRootPath("load_annotations_metadata", rootPath);
    expect(invokeMock).not.toHaveBeenCalledWith("save_annotations_metadata", expect.anything());
  });

  it("persists created annotations through the scoped metadata queue", async () => {
    const { rootPath, storage } = await scopedStorage();
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_annotations_metadata") {
        return { version: 1, books: {} };
      }
      return undefined;
    });

    const annotation = await storage.createAnnotation("book-1", {
      type: "bookmark",
      label: "Chapter start",
    });

    expect(annotation).toMatchObject({
      type: "bookmark",
      label: "Chapter start",
    });
    expectCommandRootPath("load_annotations_metadata", rootPath);
    expectCommandRootPath("save_annotations_metadata", rootPath);
    const saveCall = invokeMock.mock.calls.find(
      ([command]) => command === "save_annotations_metadata",
    );
    expect(saveCall?.[1]).toMatchObject({
      rootPath,
      metadata: {
        version: 1,
        books: {
          "book-1": {
            annotations: [{ id: annotation.id, type: "bookmark" }],
          },
        },
      },
    });
  });

  it("does not apply a pending annotation load after archive reset", async () => {
    const { storage } = await scopedStorage();
    const pending = deferred<unknown>();
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_annotations_metadata") {
        return pending.promise;
      }
      return undefined;
    });

    const list = storage.listAnnotations("book-1");
    storage.reset("C:/ArchiveB");
    pending.resolve({
      version: 1,
      books: {
        "book-1": {
          annotations: [
            {
              id: "stale",
              type: "bookmark",
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ],
        },
      },
    });

    await expect(list).rejects.toThrow("active archive changed");
  });

  it("rejects malformed annotation metadata without invoking a save", async () => {
    const { rootPath, storage } = await scopedStorage();
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_annotations_metadata") {
        return {
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
        };
      }
      return undefined;
    });

    await expect(storage.deleteAnnotation("book-1", "duplicate")).rejects.toThrow(
      'duplicate annotation id "duplicate" in book "book-1"',
    );

    expectCommandRootPath("load_annotations_metadata", rootPath);
    expect(invokeMock).not.toHaveBeenCalledWith("save_annotations_metadata", expect.anything());
  });
});
