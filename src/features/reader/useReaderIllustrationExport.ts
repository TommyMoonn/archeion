import { useCallback, useEffect, useRef, useState } from "react";

import type { ResolvedEpubIllustration } from "./epubIllustrationResolver";
import {
  exportReaderIllustrationToFile,
  type ReaderIllustrationExportResult,
} from "./readerIllustrationExportFile";

export type ReaderIllustrationExportState = Readonly<{
  message?: string;
  status: "idle" | "saving" | "saved" | "error";
}>;

type IllustrationExporter = (
  resource: ResolvedEpubIllustration,
) => Promise<ReaderIllustrationExportResult>;

const IDLE_STATE: ReaderIllustrationExportState = Object.freeze({ status: "idle" });

export function useReaderIllustrationExport(
  resource: ResolvedEpubIllustration | undefined,
  exportIllustration: IllustrationExporter = exportReaderIllustrationToFile,
): Readonly<{
  save: () => Promise<void>;
  state: ReaderIllustrationExportState;
}> {
  const [state, setState] = useState<ReaderIllustrationExportState>(IDLE_STATE);
  const mountedRef = useRef(true);
  const resourceRef = useRef(resource);
  const operationRef = useRef<Readonly<{ resource: ResolvedEpubIllustration }> | null>(null);

  useEffect(() => {
    resourceRef.current = resource;
    setState(operationRef.current ? { status: "saving" } : IDLE_STATE);
  }, [resource]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const save = useCallback(async () => {
    const source = resourceRef.current;
    if (!source || operationRef.current) return;

    const operation = Object.freeze({ resource: source });
    operationRef.current = operation;
    setState({ status: "saving" });
    try {
      const result = await exportIllustration(source);
      if (!mountedRef.current || operationRef.current !== operation) return;
      setState(
        resourceRef.current === source && result.status === "saved"
          ? { message: "Image saved.", status: "saved" }
          : IDLE_STATE,
      );
    } catch {
      if (!mountedRef.current || operationRef.current !== operation) return;
      setState(
        resourceRef.current === source
          ? { message: "Image could not be saved.", status: "error" }
          : IDLE_STATE,
      );
    } finally {
      if (operationRef.current === operation) operationRef.current = null;
    }
  }, [exportIllustration]);

  return { save, state };
}
