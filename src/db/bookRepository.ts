import type { CreateBookInput, UpdateBookInput } from "../types/book";
import { createId } from "../utils/ids";
import { db, type EpubArchiveDatabase } from "./db";

export function createBookRepository(database: EpubArchiveDatabase) {
  async function requireFolder(folderId: string | null | undefined) {
    if (!folderId) {
      return;
    }

    const folder = await database.folders.get(folderId);

    if (!folder) {
      throw new Error(`Folder "${folderId}" was not found.`);
    }
  }

  return {
    async create(input: CreateBookInput) {
      await requireFolder(input.folderId);

      const timestamp = new Date().toISOString();
      const book = {
        ...input,
        id: createId(),
        folderId: input.folderId ?? null,
        isFavorite: input.isFavorite ?? false,
        addedAt: timestamp,
        updatedAt: timestamp,
      };

      await database.books.add(book);

      return book;
    },

    get(id: string) {
      return database.books.get(id);
    },

    list() {
      return database.books.orderBy("addedAt").reverse().toArray();
    },

    async update(id: string, changes: UpdateBookInput) {
      if (changes.folderId !== undefined) {
        await requireFolder(changes.folderId);
      }

      const updated = await database.books.update(id, {
        ...changes,
        updatedAt: new Date().toISOString(),
      });

      if (updated === 0) {
        throw new Error(`Book "${id}" was not found.`);
      }

      return database.books.get(id);
    },

    async remove(id: string) {
      const book = await database.books.get(id);

      if (!book) {
        return false;
      }

      await database.books.delete(id);
      return true;
    },
  };
}

export const bookRepository = createBookRepository(db);
