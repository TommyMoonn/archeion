import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArcheionDatabase } from "../db/db";
import { IndexedDbLibraryStorage } from "./IndexedDbLibraryStorage";

describe("IndexedDbLibraryStorage", () => {
  let database: ArcheionDatabase;
  let storage: IndexedDbLibraryStorage;

  beforeEach(() => {
    database = new ArcheionDatabase(`storage-${crypto.randomUUID()}`);
    storage = new IndexedDbLibraryStorage(database);
  });

  afterEach(async () => {
    await database.delete();
  });

  it("exposes book and folder operations through one boundary", async () => {
    const folder = await storage.createFolder({
      name: "Series",
      parentId: null,
    });
    const book = await storage.createBook({
      fileName: "volume.epub",
      fileBlob: new Blob(["book"]),
      originalTitle: "Volume",
      folderId: folder.id,
    });

    await expect(storage.listBooks()).resolves.toEqual([book]);
    await expect(storage.listFolders()).resolves.toEqual([folder]);
    await expect(
      storage.updateBook(book.id, { isFavorite: true }),
    ).resolves.toMatchObject({ isFavorite: true });
  });

  it("streams collection changes without exposing Dexie to consumers", async () => {
    const observedBooks = new Promise<number>((resolve, reject) => {
      const unsubscribe = storage.observeBooks({
        next: (books) => {
          if (books.length === 1) {
            unsubscribe();
            resolve(books.length);
          }
        },
        error: reject,
      });
    });

    await storage.createBook({
      fileName: "observed.epub",
      fileBlob: new Blob(["book"]),
      originalTitle: "Observed",
    });

    await expect(observedBooks).resolves.toBe(1);
  });
});
