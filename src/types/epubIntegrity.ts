export type EpubAnalysisFileSignature = Readonly<{
  sizeBytes: number;
  modifiedAtMillis: number;
}>;

export type EpubAnalysisFileRequest = Readonly<{
  relativePath: string;
  signature: EpubAnalysisFileSignature;
}>;

export type EpubDuplicateAnalysisCandidate = EpubAnalysisFileRequest &
  Readonly<{
    identifier?: string;
  }>;

export type EpubDuplicateAnalysisGroup = Readonly<{
  kind: "exact" | "probable";
  identity: string;
  members: readonly string[];
}>;

export type EpubDuplicateAnalysisResult = Readonly<{
  archiveGeneration: number;
  requestRevision: number;
  signatures: Readonly<Record<string, EpubAnalysisFileSignature>>;
  groups: readonly EpubDuplicateAnalysisGroup[];
}>;

export type EpubDiagnosticCode =
  | "unreadable-zip"
  | "inspection-limit-exceeded"
  | "missing-container"
  | "malformed-container"
  | "missing-rootfile"
  | "unsafe-rootfile"
  | "missing-package-document"
  | "malformed-package-document"
  | "spine-manifest-item-missing"
  | "unsafe-reading-resource"
  | "reading-resource-missing"
  | "unsupported-reading-resource"
  | "encrypted-reading-resource"
  | "no-usable-reading-order"
  | "navigation-resource-missing"
  | "navigation-resource-unusable"
  | "broken-local-document-target"
  | "unsafe-local-link-target"
  | "invalid-local-link-target"
  | "readable-document-unusable";

export type EpubDiagnostics = Readonly<{
  formatVersion: number;
  issues: readonly Readonly<{
    code: EpubDiagnosticCode;
    severity: "error" | "warning";
    messageInputs?: Readonly<Record<string, string>>;
    resourcePath?: string;
  }>[];
}>;

export type EpubDiagnosticAnalysisEntry = EpubAnalysisFileRequest &
  Readonly<{
    diagnostics: EpubDiagnostics;
    source: "cached" | "computed";
  }>;

export type EpubDiagnosticAnalysisResult = Readonly<{
  archiveGeneration: number;
  requestRevision: number;
  entries: readonly EpubDiagnosticAnalysisEntry[];
}>;

export type EpubIntegrityOperation = "duplicates" | "diagnostics";
export type EpubIntegrityStatus = "idle" | "loading" | "ready" | "error";

export type EpubIntegrityError = Readonly<{
  operation: EpubIntegrityOperation;
  message: string;
}>;

export type EpubIntegrityReadState<Snapshot> = Readonly<{
  status: EpubIntegrityStatus;
  snapshot: Snapshot | null;
  error: EpubIntegrityError | null;
}>;
