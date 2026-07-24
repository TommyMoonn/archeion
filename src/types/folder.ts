// Compile-time-only ownership discriminant. It creates no persisted or runtime field.
declare const folderOwnership: unique symbol;

type FolderFields = {
  id: string;
  name: string;
  parentId?: string | null;
  relativePath?: string;
  parentPath?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Folder = FolderFields & {
  readonly [folderOwnership]?: "mutable";
};

/**
 * Application read-model Folder. Mutable Folders may flow into this boundary, while
 * snapshot-owned Folders cannot flow back into mutation-oriented Folder consumers.
 */
export type ReadonlyFolder = Readonly<FolderFields> & {
  readonly [folderOwnership]?: "mutable" | "snapshot";
};

export type CreateFolderInput = Pick<Folder, "name" | "parentId">;

export type UpdateFolderInput = Partial<Pick<Folder, "name" | "parentId">>;
