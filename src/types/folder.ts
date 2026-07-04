export type Folder = {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateFolderInput = Pick<Folder, "name" | "parentId">;

export type UpdateFolderInput = Partial<Pick<Folder, "name" | "parentId">>;
