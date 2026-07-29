import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { createReaderFileLease, type ReaderFileLease } from "./readerFileLease";

type ReaderFileLoadState =
  | { requestKey: string | null; status: "loading" }
  | { lease: ReaderFileLease; requestKey: string; status: "ready" }
  | { error: string; requestKey: string; status: "error" }
  | { requestKey: string; status: "released" };

type UseReaderFileLoadOptions = {
  load: () => Promise<Blob>;
  requestKey: string | null;
};

export type ReaderFileLoadResult =
  | { status: "loading" }
  | { lease: ReaderFileLease; status: "ready" }
  | { error: string; status: "error" }
  | { status: "released" };

export type ReaderFileLoadOwner = {
  release: () => void;
  result: ReaderFileLoadResult;
};

const EPUB_SIZE_LIMIT_ERROR = "This EPUB exceeds Archeion's 256 MiB reader limit.";
const DEFAULT_READER_FILE_ERROR =
  "The EPUB file could not be read. It may have been moved or deleted. Rescan the Library to update it.";

function readerFileErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  if (message === EPUB_SIZE_LIMIT_ERROR) return message;
  return DEFAULT_READER_FILE_ERROR;
}

export function useReaderFileLoad({
  load,
  requestKey,
}: UseReaderFileLoadOptions): ReaderFileLoadOwner {
  const [state, setState] = useState<ReaderFileLoadState>({ requestKey, status: "loading" });
  const ownerRef = useRef<ReaderFileLease | null>(null);
  const stateRef = useRef(state);

  if (state.requestKey !== requestKey) {
    setState({ requestKey, status: "loading" });
  }

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const release = useCallback(() => {
    const owner = ownerRef.current;
    if (owner?.requestKey === requestKey) {
      owner.dispose();
      ownerRef.current = null;
    }
    const current = stateRef.current;
    if (!requestKey || current.requestKey !== requestKey || current.status === "released") return;
    const releasedState = { requestKey: current.requestKey, status: "released" } as const;
    stateRef.current = releasedState;
    setState(releasedState);
  }, [requestKey]);

  const released = state.requestKey === requestKey && state.status === "released";

  useEffect(() => {
    if (!requestKey || released) {
      return;
    }

    let cancelled = false;
    void load().then(
      (blob) => {
        const lease = createReaderFileLease({
          initialBlob: blob,
          load,
          requestKey,
        });
        if (cancelled) {
          lease.dispose();
          return;
        }
        const current = stateRef.current;
        if (current.requestKey !== requestKey || current.status === "released") {
          lease.dispose();
          return;
        }
        ownerRef.current = lease;
        const readyState = { lease, requestKey, status: "ready" } as const;
        stateRef.current = readyState;
        setState(readyState);
      },
      (error: unknown) => {
        if (!cancelled) {
          const current = stateRef.current;
          if (current.requestKey === requestKey && current.status !== "released") {
            const errorState = {
              error: readerFileErrorMessage(error),
              requestKey,
              status: "error",
            } as const;
            stateRef.current = errorState;
            setState(errorState);
          }
        }
      },
    );

    return () => {
      cancelled = true;
      const owner = ownerRef.current;
      if (owner?.requestKey === requestKey) {
        owner.dispose();
        ownerRef.current = null;
      }
    };
  }, [load, released, requestKey]);

  let result: ReaderFileLoadResult;
  if (!requestKey || state.requestKey !== requestKey) {
    result = { status: "loading" };
  } else if (state.status === "ready") {
    result = { lease: state.lease, status: "ready" };
  } else if (state.status === "error") {
    result = { error: state.error, status: "error" };
  } else if (state.status === "released") {
    result = { status: "released" };
  } else {
    result = { status: "loading" };
  }

  return { release, result };
}
