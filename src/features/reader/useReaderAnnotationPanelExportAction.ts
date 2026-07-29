import { useCallback, useEffect, useRef, useState } from "react";

import type { ReaderAnnotationExportFormat } from "./readerAnnotationExport";
import type { ReaderAnnotationExportResult } from "./readerAnnotationExportFile";

export type ReaderAnnotationExportState = {
  format: ReaderAnnotationExportFormat;
  message: string;
  status: "error" | "exporting" | "success" | "warning";
};

type ActiveExport = {
  format: ReaderAnnotationExportFormat;
};

export function useReaderAnnotationPanelExportAction(
  onExport: (format: ReaderAnnotationExportFormat) => Promise<ReaderAnnotationExportResult>,
) {
  const mountedRef = useRef(true);
  const exportRef = useRef<ActiveExport | undefined>(undefined);
  const [exportState, setExportState] = useState<ReaderAnnotationExportState>();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      exportRef.current = undefined;
    };
  }, []);

  const exportAnnotations = useCallback(
    async (format: ReaderAnnotationExportFormat) => {
      if (exportRef.current) return;
      const request = { format };
      exportRef.current = request;
      setExportState({ format, message: "Exporting annotations…", status: "exporting" });
      try {
        const result = await onExport(format);
        if (!mountedRef.current || exportRef.current !== request) return;
        if (result.status === "cancelled") {
          setExportState(undefined);
        } else if (result.status === "empty") {
          setExportState({
            format,
            message: "There are no annotations to export.",
            status: "warning",
          });
        } else {
          setExportState({
            format,
            message: `${result.annotationCount} ${result.annotationCount === 1 ? "annotation" : "annotations"} exported.`,
            status: "success",
          });
        }
      } catch {
        if (mountedRef.current && exportRef.current === request) {
          setExportState({
            format,
            message: "Annotations could not be exported. Try again.",
            status: "error",
          });
        }
      } finally {
        if (exportRef.current === request) exportRef.current = undefined;
      }
    },
    [onExport],
  );

  const dismissExportState = useCallback(() => setExportState(undefined), []);

  return {
    dismissExportState,
    exportAnnotations,
    exportState,
  };
}
