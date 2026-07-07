import type { EpubSourceMetadata } from "../types/book";
import type { ArchiveImportSettings } from "../types/settings";

export type LibraryBookMetadata = {
  relativePath: string;
  isFavorite: boolean;
  coverPath?: string;
  sourceMetadata?: EpubSourceMetadata;
  fileSize?: number;
  fileModifiedAt?: number;
  addedAt: string;
  updatedAt: string;
};

export type LibraryMetadata = {
  version: 1;
  books: Record<string, LibraryBookMetadata>;
};

export type ReadingProgress = {
  cfi?: string;
  percent: number;
  lastOpenedAt?: string;
};

export type ProgressMetadata = {
  version: 1;
  progress: Record<string, ReadingProgress>;
};

export type SettingsMetadata = {
  version: 1;
  import: ArchiveImportSettings;
};

export type LegacySettingsMetadata = Partial<SettingsMetadata> & {
  reader?: unknown;
  library?: unknown;
  filesAndMetadata?: unknown;
  import?: Partial<ArchiveImportSettings> & Record<string, unknown>;
};

export type MetadataBundle = {
  library: LibraryMetadata;
  progress: ProgressMetadata;
  settings: SettingsMetadata;
};

export const defaultArchiveImportSettings: Readonly<ArchiveImportSettings> =
  Object.freeze({});

export function createLibraryMetadata(): LibraryMetadata {
  return { version: 1, books: {} };
}

export function createProgressMetadata(): ProgressMetadata {
  return { version: 1, progress: {} };
}

export function createSettingsMetadata(): SettingsMetadata {
  return {
    version: 1,
    import: { ...defaultArchiveImportSettings },
  };
}

function normalizeOptionalFolderPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().replaceAll("\\", "/");
  return trimmed ? trimmed : undefined;
}

export function normalizeArchiveImportSettings(
  settings?: Partial<ArchiveImportSettings>,
): ArchiveImportSettings {
  return {
    defaultDestinationFolderPath: normalizeOptionalFolderPath(
      settings?.defaultDestinationFolderPath,
    ),
  };
}

export function normalizeSettingsMetadata(
  metadata?: LegacySettingsMetadata,
): SettingsMetadata {
  return {
    version: 1,
    import: normalizeArchiveImportSettings(metadata?.import),
  };
}
