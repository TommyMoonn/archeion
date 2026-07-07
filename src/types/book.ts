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
  /**
   * Filesystem-derived fallback title captured during scan.
   * Parsed EPUB package metadata remains in sourceMetadata.
   */
  originalTitle: string;
  /**
   * Legacy source/fallback author field. Not an app-level display override.
   */
  originalAuthor?: string;
  sourceMetadata?: EpubSourceMetadata;
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
    "isFavorite" | "lastOpenedAt" | "progressCfi" | "progressPercent"
  >
>;
