export type Book = {
  id: string;
  fileName: string;
  fileBlob?: Blob;
  relativePath?: string;
  folderPath?: string;
  size?: number;
  modifiedAt?: string;
  originalTitle: string;
  originalAuthor?: string;
  displayTitle?: string;
  displayAuthor?: string;
  coverBlob?: Blob;
  folderId?: string | null;
  isFavorite: boolean;
  addedAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  progressCfi?: string;
  progressPercent?: number;
};

export type CreateBookInput = Omit<
  Book,
  "id" | "addedAt" | "updatedAt" | "isFavorite"
> & {
  isFavorite?: boolean;
};

export type UpdateBookInput = Partial<
  Pick<
    Book,
    | "displayTitle"
    | "displayAuthor"
    | "folderId"
    | "isFavorite"
    | "lastOpenedAt"
    | "progressCfi"
    | "progressPercent"
  >
>;
