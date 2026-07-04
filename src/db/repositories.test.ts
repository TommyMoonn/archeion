import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultReaderSettings } from "../types/reader";
import { createBookRepository } from "./bookRepository";
import { EpubArchiveDatabase } from "./db";
import { createFolderRepository } from "./folderRepository";
import { createSettingsRepository } from "./settingsRepository";

describe("local repositories", () => {
  let database: EpubArchiveDatabase;

  beforeEach(() => {
    database = new EpubArchiveDatabase(`test-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await database.delete();
  });

  it("creates, lists, updates, and removes books", async () => {
    const repository = createBookRepository(database);
    const created = await repository.create({
      fileName: "volume-01.epub",
      fileBlob: new Blob(["epub-content"], {
        type: "application/epub+zip",
      }),
      originalTitle: "Volume 01",
      originalAuthor: "Author",
    });

    expect(created.id).toBeTruthy();
    expect(created.isFavorite).toBe(false);
    expect(created.folderId).toBeNull();
    await expect(repository.list()).resolves.toEqual([created]);

    const updated = await repository.update(created.id, {
      displayTitle: "Volume One",
      isFavorite: true,
    });

    expect(updated).toMatchObject({
      displayTitle: "Volume One",
      isFavorite: true,
    });
    await expect(repository.remove(created.id)).resolves.toBe(true);
    await expect(repository.get(created.id)).resolves.toBeUndefined();
    await expect(repository.remove(created.id)).resolves.toBe(false);
  });

  it("retains records when the database is reopened", async () => {
    const repository = createBookRepository(database);
    const created = await repository.create({
      fileName: "persistent.epub",
      fileBlob: new Blob(["epub-content"]),
      originalTitle: "Persistent Book",
    });
    const databaseName = database.name;

    database.close();
    database = new EpubArchiveDatabase(databaseName);

    await expect(
      createBookRepository(database).get(created.id),
    ).resolves.toMatchObject({
      fileName: "persistent.epub",
      originalTitle: "Persistent Book",
    });
  });

  it("rejects updates for missing books", async () => {
    const repository = createBookRepository(database);

    await expect(
      repository.update("missing-book", { isFavorite: true }),
    ).rejects.toThrow('Book "missing-book" was not found.');
  });

  it("prevents books from referencing missing folders", async () => {
    const repository = createBookRepository(database);

    await expect(
      repository.create({
        fileName: "volume-03.epub",
        fileBlob: new Blob(["epub-content"]),
        originalTitle: "Volume 03",
        folderId: "missing-folder",
      }),
    ).rejects.toThrow('Folder "missing-folder" was not found.');
  });

  it("normalizes folder names and preserves contents when deleting", async () => {
    const books = createBookRepository(database);
    const folders = createFolderRepository(database);
    const parent = await folders.create({
      name: "  Light novels  ",
      parentId: null,
    });
    const child = await folders.create({
      name: "Favorites",
      parentId: parent.id,
    });
    const book = await books.create({
      fileName: "volume-02.epub",
      fileBlob: new Blob(["epub-content"]),
      originalTitle: "Volume 02",
      folderId: parent.id,
    });

    expect(parent.name).toBe("Light novels");
    await expect(folders.remove(parent.id)).resolves.toBe(true);
    await expect(folders.get(parent.id)).resolves.toBeUndefined();
    await expect(folders.get(child.id)).resolves.toMatchObject({
      parentId: null,
    });
    await expect(books.get(book.id)).resolves.toMatchObject({
      folderId: null,
    });
  });

  it("rejects empty folder names", async () => {
    const repository = createFolderRepository(database);

    await expect(
      repository.create({ name: "   ", parentId: null }),
    ).rejects.toThrow("Folder name cannot be empty.");
  });

  it("prevents cycles in the folder hierarchy", async () => {
    const repository = createFolderRepository(database);
    const parent = await repository.create({
      name: "Series",
      parentId: null,
    });
    const child = await repository.create({
      name: "Volumes",
      parentId: parent.id,
    });

    await expect(
      repository.update(parent.id, { parentId: child.id }),
    ).rejects.toThrow("A folder cannot contain itself.");
    await expect(
      repository.update(child.id, { parentId: child.id }),
    ).rejects.toThrow("A folder cannot contain itself.");
  });

  it("loads defaults and persists reader settings", async () => {
    const repository = createSettingsRepository(database);

    await expect(repository.get()).resolves.toEqual(defaultReaderSettings);
    await expect(repository.update({ fontSize: 22, theme: "sepia" })).resolves
      .toMatchObject({
        fontSize: 22,
        theme: "sepia",
      });
    await expect(repository.get()).resolves.toMatchObject({
      fontSize: 22,
      theme: "sepia",
    });
    await expect(repository.reset()).resolves.toEqual(defaultReaderSettings);
    await expect(repository.get()).resolves.toEqual(defaultReaderSettings);
  });
});
