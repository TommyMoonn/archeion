export const DATABASE_NAME = "archeion";
export const DATABASE_VERSION = 1;

export const databaseStores = {
  books:
    "id, folderId, addedAt, updatedAt, lastOpenedAt, originalTitle, originalAuthor",
  folders: "id, parentId, name, createdAt, updatedAt",
  settings: "key",
} as const;
