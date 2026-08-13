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
