import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  archiveIntegrityCommandClient,
  type ArchiveIntegrityCommandClient,
} from "../../storage/archiveCommandClient";
import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type {
  EpubAnalysisFileRequest,
  EpubDiagnosticAnalysisResult,
  EpubDuplicateAnalysisCandidate,
  EpubDuplicateAnalysisResult,
  EpubIntegrityError,
  EpubIntegrityOperation,
  EpubIntegrityReadState,
} from "../../types/epubIntegrity";
import { libraryBookAnalysisFile } from "./libraryIntegrityFiles";

type IntegrityScope = Readonly<{
  archiveGeneration: number;
  archiveRootPath: string;
  key: string;
}>;

type ScopedReadState<Snapshot> = EpubIntegrityReadState<Snapshot> &
  Readonly<{
    scopeKey: string | null;
  }>;

type ActiveOwnership = Readonly<{
  scopeKey: string | null;
  token: object;
}>;

const nextRequestRevisionByOperation: Record<EpubIntegrityOperation, number> = {
  diagnostics: 0,
  duplicates: 0,
};

function allocateRequestRevision(operation: EpubIntegrityOperation): number {
  nextRequestRevisionByOperation[operation] += 1;
  return nextRequestRevisionByOperation[operation];
}

export type UseLibraryIntegrityInput = Readonly<{
  archiveGeneration: number | null | undefined;
  archiveRootPath: string | null | undefined;
  books: readonly LibrarySnapshotBook[] | null | undefined;
  commandClient?: ArchiveIntegrityCommandClient;
}>;

export type LibraryIntegrityController = Readonly<{
  duplicates: EpubIntegrityReadState<EpubDuplicateAnalysisResult>;
  diagnostics: EpubIntegrityReadState<EpubDiagnosticAnalysisResult>;
  refreshDuplicates: () => Promise<boolean>;
  refreshDiagnostics: () => Promise<boolean>;
}>;

function idleState<Snapshot>(scopeKey: string | null): ScopedReadState<Snapshot> {
  return { error: null, scopeKey, snapshot: null, status: "idle" };
}

function visibleState<Snapshot>(
  state: ScopedReadState<Snapshot>,
  scopeKey: string | null,
): EpubIntegrityReadState<Snapshot> {
  if (state.scopeKey !== scopeKey) return { error: null, snapshot: null, status: "idle" };
  return { error: state.error, snapshot: state.snapshot, status: state.status };
}

function integrityScope(
  archiveGeneration: number | null | undefined,
  archiveRootPath: string | null | undefined,
): IntegrityScope | null {
  if (archiveGeneration === null || archiveGeneration === undefined || !archiveRootPath)
    return null;
  return {
    archiveGeneration,
    archiveRootPath,
    key: `${archiveGeneration}\u0000${archiveRootPath}`,
  };
}

function analysisInputs(books: readonly LibrarySnapshotBook[] | null | undefined): Readonly<{
  candidates: readonly EpubDuplicateAnalysisCandidate[];
  files: readonly EpubAnalysisFileRequest[];
}> {
  const files: EpubAnalysisFileRequest[] = [];
  const candidates: EpubDuplicateAnalysisCandidate[] = [];
  for (const book of books ?? []) {
    const file = libraryBookAnalysisFile(book);
    if (!file) continue;
    files.push(file);
    const identifier = book.sourceMetadata?.identifier?.trim();
    candidates.push(identifier ? { ...file, identifier } : file);
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { candidates, files };
}

function requestError(operation: EpubIntegrityOperation): EpubIntegrityError {
  return {
    operation,
    message:
      operation === "duplicates"
        ? "Duplicate analysis could not be refreshed."
        : "EPUB diagnostics could not be refreshed.",
  };
}

export function useLibraryIntegrity({
  archiveGeneration,
  archiveRootPath,
  books,
  commandClient = archiveIntegrityCommandClient,
}: UseLibraryIntegrityInput): LibraryIntegrityController {
  const scope = useMemo(
    () => integrityScope(archiveGeneration, archiveRootPath),
    [archiveGeneration, archiveRootPath],
  );
  const inputs = useMemo(() => analysisInputs(books), [books]);
  const ownership = useMemo<ActiveOwnership>(
    () => ({ scopeKey: scope?.key ?? null, token: {} }),
    [scope?.key],
  );
  const [duplicates, setDuplicates] = useState<ScopedReadState<EpubDuplicateAnalysisResult>>(() =>
    idleState(scope?.key ?? null),
  );
  const [diagnostics, setDiagnostics] = useState<ScopedReadState<EpubDiagnosticAnalysisResult>>(
    () => idleState(scope?.key ?? null),
  );
  const ownershipRef = useRef<ActiveOwnership>(ownership);
  const activeRequestRef = useRef<Record<EpubIntegrityOperation, object | null>>({
    diagnostics: null,
    duplicates: null,
  });
  const mountedRef = useRef(false);
  const latestRef = useRef({ commandClient, inputs, scope });

  useLayoutEffect(() => {
    if (ownershipRef.current.token !== ownership.token) {
      ownershipRef.current = ownership;
      activeRequestRef.current = { diagnostics: null, duplicates: null };
    }
    latestRef.current = { commandClient, inputs, scope };
  }, [commandClient, inputs, ownership, scope]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ownershipRef.current = { scopeKey: null, token: {} };
      activeRequestRef.current = { diagnostics: null, duplicates: null };
    };
  }, []);

  const ownsRequest = useCallback(
    (
      operation: EpubIntegrityOperation,
      requestToken: object,
      ownership: ActiveOwnership,
      revision: number,
      resultRevision?: number,
    ): boolean =>
      mountedRef.current &&
      activeRequestRef.current[operation] === requestToken &&
      ownershipRef.current.token === ownership.token &&
      latestRef.current.scope?.key === ownership.scopeKey &&
      (resultRevision === undefined || resultRevision === revision),
    [],
  );

  const refreshDuplicates = useCallback(async (): Promise<boolean> => {
    const current = latestRef.current;
    if (!current.scope) return false;
    const { scope } = current;
    const ownership = ownershipRef.current;
    const requestToken = {};
    activeRequestRef.current.duplicates = requestToken;
    const requestRevision = allocateRequestRevision("duplicates");
    setDuplicates((state) => ({
      error: null,
      scopeKey: scope.key,
      snapshot: state.scopeKey === scope.key ? state.snapshot : null,
      status: "loading",
    }));
    try {
      const result = await current.commandClient.requestDuplicateAnalysis(
        {
          archiveGeneration: scope.archiveGeneration,
          candidates: current.inputs.candidates,
          requestRevision,
        },
        scope.archiveRootPath,
      );
      if (
        result.archiveGeneration !== scope.archiveGeneration ||
        !ownsRequest("duplicates", requestToken, ownership, requestRevision, result.requestRevision)
      ) {
        return false;
      }
      setDuplicates({
        error: null,
        scopeKey: scope.key,
        snapshot: result,
        status: "ready",
      });
      return true;
    } catch {
      if (!ownsRequest("duplicates", requestToken, ownership, requestRevision)) return false;
      setDuplicates((state) => ({
        error: requestError("duplicates"),
        scopeKey: scope.key,
        snapshot: state.scopeKey === scope.key ? state.snapshot : null,
        status: "error",
      }));
      return false;
    }
  }, [ownsRequest]);

  const refreshDiagnostics = useCallback(async (): Promise<boolean> => {
    const current = latestRef.current;
    if (!current.scope) return false;
    const { scope } = current;
    const ownership = ownershipRef.current;
    const requestToken = {};
    activeRequestRef.current.diagnostics = requestToken;
    const requestRevision = allocateRequestRevision("diagnostics");
    setDiagnostics((state) => ({
      error: null,
      scopeKey: scope.key,
      snapshot: state.scopeKey === scope.key ? state.snapshot : null,
      status: "loading",
    }));
    try {
      const result = await current.commandClient.requestDiagnostics(
        {
          archiveGeneration: scope.archiveGeneration,
          files: current.inputs.files,
          requestRevision,
        },
        scope.archiveRootPath,
      );
      if (
        result.archiveGeneration !== scope.archiveGeneration ||
        !ownsRequest(
          "diagnostics",
          requestToken,
          ownership,
          requestRevision,
          result.requestRevision,
        )
      ) {
        return false;
      }
      setDiagnostics({
        error: null,
        scopeKey: scope.key,
        snapshot: result,
        status: "ready",
      });
      return true;
    } catch {
      if (!ownsRequest("diagnostics", requestToken, ownership, requestRevision)) return false;
      setDiagnostics((state) => ({
        error: requestError("diagnostics"),
        scopeKey: scope.key,
        snapshot: state.scopeKey === scope.key ? state.snapshot : null,
        status: "error",
      }));
      return false;
    }
  }, [ownsRequest]);

  return {
    diagnostics: visibleState(diagnostics, scope?.key ?? null),
    duplicates: visibleState(duplicates, scope?.key ?? null),
    refreshDiagnostics,
    refreshDuplicates,
  };
}
