import type {
  EpubAnalysisFileRequest,
  EpubDiagnosticAnalysisResult,
  EpubDuplicateAnalysisCandidate,
  EpubDuplicateAnalysisResult,
} from "../types/epubIntegrity";
import { ArchiveCommandClient } from "./tauri/archiveCommandClient";

export type EpubDuplicateAnalysisRequest = Readonly<{
  archiveGeneration: number;
  requestRevision: number;
  candidates: readonly EpubDuplicateAnalysisCandidate[];
}>;

export type EpubDiagnosticAnalysisRequest = Readonly<{
  archiveGeneration: number;
  requestRevision: number;
  files: readonly EpubAnalysisFileRequest[];
}>;

export type ArchiveIntegrityCommandClient = Readonly<{
  requestDuplicateAnalysis: (
    request: EpubDuplicateAnalysisRequest,
    rootPath: string,
  ) => Promise<EpubDuplicateAnalysisResult>;
  requestDiagnostics: (
    request: EpubDiagnosticAnalysisRequest,
    rootPath: string,
  ) => Promise<EpubDiagnosticAnalysisResult>;
}>;

const commands = new ArchiveCommandClient();

export const archiveIntegrityCommandClient: ArchiveIntegrityCommandClient = {
  requestDuplicateAnalysis: (request, rootPath) =>
    commands.invoke("request_epub_duplicate_analysis", request, rootPath),
  requestDiagnostics: (request, rootPath) =>
    commands.invoke("request_epub_diagnostics", request, rootPath),
};
