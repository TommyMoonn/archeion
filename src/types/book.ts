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

export type ReadonlyEpubSourceMetadata = Readonly<
  Omit<EpubSourceMetadata, "subjects"> & {
    subjects?: readonly string[];
  }
>;

export type EpubMetadataWritebackInput = Omit<EpubSourceMetadata, "identifier">;

export type EpubCoverFraming = "crop" | "fit";

export type EpubCoverPreparation = {
  fileName: string;
  sourceFormat: string;
  outputFormat: string;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  imageSize: number;
  imageModifiedAt: number;
  epubSize: number;
  epubModifiedAt: number;
  replacingExistingCover: boolean;
  previewMimeType: string;
  previewBytes: number[];
};

export type EpubCoverWritebackInput = {
  imagePath: string;
  framing: EpubCoverFraming;
  expectedImageSize: number;
  expectedImageModifiedAt: number;
  expectedEpubSize: number;
  expectedEpubModifiedAt: number;
};

export type BulkMetadataTagMode = "replace" | "add" | "remove";

export type BulkMetadataEditInput = {
  series?: string | null;
  publisher?: string | null;
  language?: string | null;
  subjects?: {
    mode: BulkMetadataTagMode;
    values: string[];
  };
};

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

export type EpubCoverWritebackResult = EpubMetadataWritebackResult & {
  coverCacheWarning?: string | null;
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

export type ReadonlyBook = Readonly<
  Omit<Book, "sourceMetadata"> & {
    sourceMetadata?: ReadonlyEpubSourceMetadata;
  }
>;

export type UpdateBookInput = Partial<
  Pick<Book, "isFavorite" | "lastOpenedAt" | "progressCfi" | "progressPercent">
>;
