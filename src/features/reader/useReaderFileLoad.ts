import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { createReaderFileLease, type ReaderFileLease } from "./readerFileLease";

type ReaderSourceRequest = Readonly<{
  load: () => Promise<Blob>;
  requestKey: string;
  revision: number;
}>;

type ReaderSourceState =
  | { request: null; status: "inactive" }
  | { request: ReaderSourceRequest; status: "loading" }
  | { lease: ReaderFileLease; request: ReaderSourceRequest; status: "ready" }
  | { error: string; request: ReaderSourceRequest; retryable: boolean; status: "error" };

export type ExternalReaderFileSource = Readonly<{
  load: () => Promise<Blob>;
  requestKey: string;
}>;

type UseReaderSourceOptions = {
  active: boolean;
  archiveId: string | null;
  archiveRootPath: string | null;
  bookId: string | null;
  storage: Pick<LibraryStorage, "loadBookFile">;
  external?: ExternalReaderFileSource;
};

export type ReaderSourceController =
  | Readonly<{ retry: () => void; status: "inactive" | "loading" }>
  | Readonly<{ lease: ReaderFileLease; retry: () => void; status: "ready" }>
  | Readonly<{ error: string; retry: () => void; retryable: boolean; status: "error" }>;

const EPUB_SIZE_LIMIT_ERROR = "This EPUB exceeds Archeion's 256 MiB reader limit.";
const DEFAULT_READER_FILE_ERROR =
  "The EPUB file could not be read. It may have been moved or deleted. Rescan the Library to update it.";
const EXTERNAL_READER_FILE_ERROR =
  "The selected EPUB could not be read. It may have been moved or become unavailable.";

function readerFileError(
  error: unknown,
  external: boolean,
): Readonly<{ message: string; retryable: boolean }> {
  const message =
    error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  if (message === EPUB_SIZE_LIMIT_ERROR) return { message, retryable: false };
  return {
    message: external ? EXTERNAL_READER_FILE_ERROR : DEFAULT_READER_FILE_ERROR,
    retryable: true,
  };
}

function sourceRequestKey(
  active: boolean,
  archiveId: string | null,
  archiveRootPath: string | null,
  bookId: string | null,
): string | null {
  return active && archiveId && bookId
    ? JSON.stringify([archiveId, archiveRootPath, bookId])
    : null;
}

export function useReaderSource({
  active,
  archiveId,
  archiveRootPath,
  bookId,
  storage,
  external,
}: UseReaderSourceOptions): ReaderSourceController {
  const requestKey = active
    ? (external?.requestKey ?? sourceRequestKey(active, archiveId, archiveRootPath, bookId))
    : null;
  const [retryOwner, setRetryOwner] = useState<{ requestKey: string; revision: number } | null>(
    null,
  );
  const retryRevision = retryOwner?.requestKey === requestKey ? retryOwner.revision : 0;
  const request = useMemo<ReaderSourceRequest | null>(() => {
    if (!requestKey || (!bookId && !external)) return null;
    return Object.freeze({
      load: () => (external ? external.load() : storage.loadBookFile(bookId!)),
      requestKey,
      revision: retryRevision,
    });
  }, [bookId, external, requestKey, retryRevision, storage]);
  const [state, setState] = useState<ReaderSourceState>(() =>
    request ? { request, status: "loading" } : { request: null, status: "inactive" },
  );
  const ownerRef = useRef<{ lease: ReaderFileLease; request: ReaderSourceRequest } | null>(null);
  const stateRef = useRef(state);

  if (state.request !== request) {
    setState(request ? { request, status: "loading" } : { request: null, status: "inactive" });
  }

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!request) return;

    let retired = false;
    void request.load().then(
      (blob) => {
        const lease = createReaderFileLease({
          initialBlob: blob,
          load: request.load,
          requestKey: request.requestKey,
        });
        if (retired || stateRef.current.request !== request) {
          lease.dispose();
          return;
        }
        ownerRef.current = { lease, request };
        const readyState = { lease, request, status: "ready" } as const;
        stateRef.current = readyState;
        setState(readyState);
      },
      (error: unknown) => {
        if (retired || stateRef.current.request !== request) return;
        const failure = readerFileError(error, Boolean(external));
        const errorState = {
          error: failure.message,
          request,
          retryable: failure.retryable,
          status: "error",
        } as const;
        stateRef.current = errorState;
        setState(errorState);
      },
    );

    return () => {
      retired = true;
      const owner = ownerRef.current;
      if (owner?.request === request) {
        owner.lease.dispose();
        ownerRef.current = null;
      }
    };
  }, [request, external]);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (
      !requestKey ||
      current.status !== "error" ||
      !current.retryable ||
      current.request.requestKey !== requestKey
    ) {
      return;
    }
    setRetryOwner((owner) => ({
      requestKey,
      revision: owner?.requestKey === requestKey ? owner.revision + 1 : 1,
    }));
  }, [requestKey]);

  if (state.request !== request || state.status === "inactive") {
    return { retry, status: request ? "loading" : "inactive" };
  }
  if (state.status === "ready") return { lease: state.lease, retry, status: "ready" };
  if (state.status === "error") {
    return { error: state.error, retry, retryable: state.retryable, status: "error" };
  }
  return { retry, status: "loading" };
}
