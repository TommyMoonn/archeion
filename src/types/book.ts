export type EpubSourceMetadata = {
  title?: string;
  creator?: string;
  identifier?: string;
  language?: string;
  publisher?: string;
  date?: string;
  description?: string;
  subjects?: string[];
  series?: string;
  volume?: string;
};

export type EpubMetadataWritebackInput = Omit<EpubSourceMetadata, "identifier">;

export type EpubMetadataWritebackFileStat = {
  relativePath: string;
  fileName: string;
  folderPath: string;
  size: number;
  modifiedAt: number;
};

export type EpubMetadataWritebackResult = {
  backupPath?: string | null;
  sourceMetadata: EpubSourceMetadata;
  fileStat: EpubMetadataWritebackFileStat;
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
  coverRevision?: string;
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
  Pick<Book, "isFavorite" | "lastOpenedAt" | "progressCfi" | "progressPercent">
>;
