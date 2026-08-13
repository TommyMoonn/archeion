export type DictionaryCatalogPackageFormat = "stardict-zip";

export type DictionaryCatalogEntry = Readonly<{
  id: string;
  name: string;
  language: string;
  description: string;
  sourceAttribution: string;
  sourceUrl: string | null;
  licenseName: string;
  licenseUrl: string;
  packageVersion: string;
  compressedSizeBytes: number;
  installedSizeEstimateBytes: number | null;
  downloadUrl: string;
  packageFormat: DictionaryCatalogPackageFormat;
  sha256: string;
}>;

export type DictionaryCatalogSnapshot = Readonly<{
  schemaVersion: number;
  entries: readonly DictionaryCatalogEntry[];
  source: "cache" | "network";
  cacheWarning: string | null;
}>;

export type DictionaryDownloadProgress = Readonly<{
  receivedBytes: number;
  totalBytes: number;
}>;

export type VerifiedDictionaryDownload = Readonly<{
  stagingToken: string;
  catalogId: string;
  packageFormat: DictionaryCatalogPackageFormat;
  sizeBytes: number;
  sha256: string;
}>;

export type DictionaryDownloadOutcome =
  | Readonly<{
      status: "succeeded";
      package: VerifiedDictionaryDownload;
    }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "failed"; message: string }>;

export type DictionarySourceKind = "catalog" | "manual-import";
export type DictionaryIndexState = "pending" | "ready" | "rebuild-required" | "unavailable";

export type InstalledDictionary = Readonly<{
  id: string;
  displayName: string;
  language: string;
  enabled: boolean;
  order: number;
  entryCount: number;
  installedSizeBytes: number;
  sourceKind: DictionarySourceKind;
  catalogId: string | null;
  sourceAttribution: string;
  licenseName: string;
  licenseUrl: string | null;
  packageVersion: string;
  indexState: DictionaryIndexState;
  storageRelativePath: string;
}>;

export type DictionaryRecoveryState = Readonly<{
  reason: "corrupt-database" | "unsupported-schema";
  message: string;
}>;

export type DictionaryRegistrySnapshot = Readonly<{
  status: "ready" | "recovery-required";
  dictionaries: readonly InstalledDictionary[];
  recovery: DictionaryRecoveryState | null;
}>;

export type DictionaryDefinitionEntry = Readonly<{
  dictionaryId: string;
  dictionaryName: string;
  displayHeadword: string;
  definitionTextBlocks: readonly string[];
  sourceAttribution: string;
}>;

export type DictionaryLookupResponse = Readonly<{
  normalizedQuery: string;
  entries: readonly DictionaryDefinitionEntry[];
  truncated: boolean;
}>;
