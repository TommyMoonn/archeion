import type {
  CreateFolderInput,
  UpdateFolderInput,
} from "../types/folder";
import { createId } from "../utils/ids";
import { db, type EpubArchiveDatabase } from "./db";

function normalizeName(name: string): string {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new Error("Folder name cannot be empty.");
  }

  return normalizedName;
}

export function createFolderRepository(database: EpubArchiveDatabase) {
  async function validateParent(
    parentId: string | null | undefined,
    folderId?: string,
  ) {
    let currentId = parentId;
    const visitedIds = new Set<string>();

    while (currentId) {
      if (currentId === folderId) {
        throw new Error("A folder cannot contain itself.");
      }

      if (visitedIds.has(currentId)) {
        throw new Error("The folder hierarchy contains a cycle.");
      }

      visitedIds.add(currentId);

      const parent = await database.folders.get(currentId);

      if (!parent) {
        throw new Error(`Folder "${currentId}" was not found.`);
      }

      currentId = parent.parentId;
    }
  }

  return {
    async create(input: CreateFolderInput) {
      await validateParent(input.parentId);

      const timestamp = new Date().toISOString();
      const folder = {
        id: createId(),
        name: normalizeName(input.name),
        parentId: input.parentId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await database.folders.add(folder);

      return folder;
    },

    get(id: string) {
      return database.folders.get(id);
    },

    list() {
      return database.folders.orderBy("name").toArray();
    },

    async update(id: string, changes: UpdateFolderInput) {
      if (changes.parentId !== undefined) {
        await validateParent(changes.parentId, id);
      }

      const normalizedChanges = {
        ...changes,
        ...(changes.name === undefined
          ? {}
          : { name: normalizeName(changes.name) }),
        updatedAt: new Date().toISOString(),
      };
      const updated = await database.folders.update(id, normalizedChanges);

      if (updated === 0) {
        throw new Error(`Folder "${id}" was not found.`);
      }

      return database.folders.get(id);
    },

    async remove(id: string) {
      const folder = await database.folders.get(id);

      if (!folder) {
        return false;
      }

      await database.transaction(
        "rw",
        database.books,
        database.folders,
        async () => {
          const timestamp = new Date().toISOString();

          await database.books.where("folderId").equals(id).modify({
            folderId: null,
            updatedAt: timestamp,
          });
          await database.folders.where("parentId").equals(id).modify({
            parentId: null,
            updatedAt: timestamp,
          });
          await database.folders.delete(id);
        },
      );

      return true;
    },
  };
}

export const folderRepository = createFolderRepository(db);
