export type EpubSourceMetadata = {
  title?: string;
  creator?: string;
  identifier?: string;
  language?: string;
};

export type Book = {
  id: string;
  fileName: string;
  relativePath?: string;
  folderPath?: string;
  size?: number;
  modifiedAt?: string;
  originalTitle: string;
  originalAuthor?: string;
  sourceMetadata?: EpubSourceMetadata;
  displayTitle?: string;
  displayAuthor?: string;
  coverPath?: string;
  isFileMissing?: boolean;
  folderId?: string | null;
  isFavorite: boolean;
  addedAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  progressCfi?: string;
  progressPercent?: number;
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
