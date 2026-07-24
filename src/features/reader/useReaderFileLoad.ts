import { useCallback, useEffect, useState } from "react";

import { markPerformance } from "../../utils/measurePerformance";

type ReaderFileLoadState =
  | { requestKey: string | null; status: "loading" }
  | { blob: Blob; requestKey: string; status: "ready" }
  | { error: string; requestKey: string; status: "error" }
  | { requestKey: string; status: "released" };

type UseReaderFileLoadOptions = {
  load: () => Promise<Blob>;
  requestKey: string | null;
};

export type ReaderFileLoadResult =
  | { status: "loading" }
  | { blob: Blob; status: "ready" }
  | { error: string; status: "error" }
  | { status: "released" };

export type ReaderFileLoadOwner = {
  release: () => void;
  result: ReaderFileLoadResult;
};

const DEFAULT_READER_FILE_ERROR = "The EPUB file may have been moved or deleted.";

function readerFileErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return DEFAULT_READER_FILE_ERROR;
}

export function useReaderFileLoad({
  load,
  requestKey,
}: UseReaderFileLoadOptions): ReaderFileLoadOwner {
  const [state, setState] = useState<ReaderFileLoadState>({ requestKey, status: "loading" });

  if (state.requestKey !== requestKey) {
    setState({ requestKey, status: "loading" });
  }

  const release = useCallback(() => {
    setState((current) => {
      if (!requestKey || current.requestKey !== requestKey || current.status === "released") {
        return current;
      }
      markPerformance("archeion:reader-source-bytes-released");
      return { requestKey: current.requestKey, status: "released" };
    });
  }, [requestKey]);

  const released = state.requestKey === requestKey && state.status === "released";

  useEffect(() => {
    if (!requestKey || released) {
      return;
    }

    let cancelled = false;
    void load().then(
      (blob) => {
        if (!cancelled) {
          setState((current) =>
            current.requestKey === requestKey && current.status !== "released"
              ? { blob, requestKey, status: "ready" }
              : current,
          );
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState((current) =>
            current.requestKey === requestKey && current.status !== "released"
              ? { error: readerFileErrorMessage(error), requestKey, status: "error" }
              : current,
          );
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [load, released, requestKey]);

  let result: ReaderFileLoadResult;
  if (!requestKey || state.requestKey !== requestKey) {
    result = { status: "loading" };
  } else if (state.status === "ready") {
    result = { blob: state.blob, status: "ready" };
  } else if (state.status === "error") {
    result = { error: state.error, status: "error" };
  } else if (state.status === "released") {
    result = { status: "released" };
  } else {
    result = { status: "loading" };
  }

  return { release, result };
}
