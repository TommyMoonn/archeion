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
