import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import {
  createReaderAnnotationExportDocument,
  readerAnnotationExportCount,
  readerAnnotationExportFileName,
  serializeReaderAnnotationExport,
  type ReaderAnnotationExportBook,
  type ReaderAnnotationExportFormat,
} from "./readerAnnotationExport";

export type ReaderAnnotationExportResult =
  | { status: "cancelled" }
  | { status: "empty" }
  | { annotationCount: number; bookCount: number; path: string; status: "saved" };

function annotationExportExtension(format: ReaderAnnotationExportFormat): "json" | "md" {
  return format === "json" ? "json" : "md";
}

export function normalizeAnnotationExportPath(
  path: string,
  format: ReaderAnnotationExportFormat,
): string {
  const expectedExtension = annotationExportExtension(format);
  const fileName = path.replaceAll("\\", "/").split("/").pop() ?? "";
  const extensionSeparator = fileName.lastIndexOf(".");
  const extension = extensionSeparator > 0 ? fileName.slice(extensionSeparator + 1) : "";
  if (extension.toLocaleLowerCase() === expectedExtension) return path;

  const formatLabel = format === "json" ? "JSON" : "Markdown";
  throw new Error(`${formatLabel} exports require a .${expectedExtension} file name.`);
}

export async function exportReaderAnnotationsToFile({
  books,
  archiveScope,
  assertCurrent,
  exportedAt,
  format,
}: {
  books: readonly ReaderAnnotationExportBook[];
  archiveScope?: { activationRevision: number; archiveId: string; rootPath: string };
  assertCurrent?: () => void;
  exportedAt?: string;
  format: ReaderAnnotationExportFormat;
}): Promise<ReaderAnnotationExportResult> {
  const document = createReaderAnnotationExportDocument(books, exportedAt);
  const annotationCount = readerAnnotationExportCount(document);
  if (annotationCount === 0) return { status: "empty" };

  const extension = annotationExportExtension(format);
  const path = await save({
    defaultPath: readerAnnotationExportFileName(document, format),
    filters: [
      {
        extensions: [extension],
        name: format === "json" ? "JSON" : "Markdown",
      },
    ],
    title: "Export annotations",
  });
  if (!path) return { status: "cancelled" };
  const normalizedPath = normalizeAnnotationExportPath(path, format);

  const contents = serializeReaderAnnotationExport(document, format, {
    includeDetails: Boolean(archiveScope),
  });
  assertCurrent?.();
  await invoke<void>("write_annotation_export_file", {
    ...(archiveScope ? { archiveScope } : {}),
    contents,
    format,
    path: normalizedPath,
  });

  return {
    annotationCount,
    bookCount: document.books.length,
    path: normalizedPath,
    status: "saved",
  };
}
