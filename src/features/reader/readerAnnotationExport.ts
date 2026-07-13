import type { Annotation } from "../../types/annotation";
import type { ReaderChapter } from "../../types/reader";
import { readerAnnotationChapterLabel } from "./readerAnnotations";

export const READER_ANNOTATION_EXPORT_VERSION = 1 as const;
export const READER_ANNOTATION_EXPORT_SCHEMA = "archeion.annotation-export" as const;

export type ReaderAnnotationExportFormat = "json" | "markdown";

export type ReaderAnnotationExportBook = {
  annotations: readonly Annotation[];
  author?: string;
  chapters?: readonly ReaderChapter[];
  id: string;
  title: string;
};

export type ReaderAnnotationExportRecord = {
  annotation: Annotation;
  chapterLabel: string;
};

export type ReaderAnnotationExportDocument = {
  schema: typeof READER_ANNOTATION_EXPORT_SCHEMA;
  version: typeof READER_ANNOTATION_EXPORT_VERSION;
  exportedAt: string;
  books: Array<{
    id: string;
    title: string;
    author?: string;
    annotations: ReaderAnnotationExportRecord[];
  }>;
};

function cleanText(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function snapshotAnnotation(annotation: Annotation): Annotation {
  return JSON.parse(JSON.stringify(annotation)) as Annotation;
}

export function createReaderAnnotationExportDocument(
  books: readonly ReaderAnnotationExportBook[],
  exportedAt = new Date().toISOString(),
): ReaderAnnotationExportDocument {
  return {
    schema: READER_ANNOTATION_EXPORT_SCHEMA,
    version: READER_ANNOTATION_EXPORT_VERSION,
    exportedAt,
    books: books.map((book) => ({
      id: book.id,
      title: cleanText(book.title) ?? "Untitled",
      ...(cleanText(book.author) ? { author: cleanText(book.author) } : {}),
      annotations: book.annotations.map((annotation) => ({
        annotation: snapshotAnnotation(annotation),
        chapterLabel: readerAnnotationChapterLabel(annotation, book.chapters ?? []),
      })),
    })),
  };
}

const MARKDOWN_SYNTAX_CHARACTERS = new Set("\\`*_{}[]<>#+-.!|");

function escapeMarkdown(value: string): string {
  return [...value]
    .map((character) => (MARKDOWN_SYNTAX_CHARACTERS.has(character) ? `\\${character}` : character))
    .join("");
}

function markdownLines(value: string, prefix = ""): string[] {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => `${prefix}${escapeMarkdown(line)}`);
}

function locationReference(annotation: Annotation): string {
  return cleanText(annotation.cfiRange) ?? cleanText(annotation.chapterHref) ?? "Unavailable";
}

function annotationMarkdown(record: ReaderAnnotationExportRecord): string[] {
  const { annotation } = record;
  const lines: string[] = [];
  if (annotation.type === "bookmark") {
    lines.push(
      `#### Bookmark${cleanText(annotation.label) ? `: ${escapeMarkdown(cleanText(annotation.label)!)}` : ""}`,
    );
  } else {
    lines.push("#### Highlight", "", ...markdownLines(annotation.selectedText, "> "));
    if (cleanText(annotation.note)) {
      lines.push("", "**Note**", "", ...markdownLines(annotation.note!, "> "));
    }
  }
  lines.push("", `**Location:** \`${locationReference(annotation).replaceAll("`", "\\`")}\``);
  if (annotation.anchorStatus === "detached") lines.push("", "**Detached:** Yes");
  return lines;
}

export function serializeReaderAnnotationMarkdown(
  document: ReaderAnnotationExportDocument,
): string {
  const lines = ["# Archeion annotations", "", `Exported: ${document.exportedAt}`];

  for (const book of document.books) {
    lines.push("", `## ${escapeMarkdown(book.title)}`);
    if (book.author) lines.push("", `Author: ${escapeMarkdown(book.author)}`);

    const chapters = new Map<string, ReaderAnnotationExportRecord[]>();
    for (const record of book.annotations) {
      const records = chapters.get(record.chapterLabel) ?? [];
      records.push(record);
      chapters.set(record.chapterLabel, records);
    }

    for (const [chapterLabel, records] of chapters) {
      lines.push("", `### ${escapeMarkdown(chapterLabel)}`);
      for (const record of records) lines.push("", ...annotationMarkdown(record));
    }
  }

  return `${lines.join("\n")}\n`;
}

export function serializeReaderAnnotationExport(
  document: ReaderAnnotationExportDocument,
  format: ReaderAnnotationExportFormat,
): string {
  return format === "json"
    ? `${JSON.stringify(document, null, 2)}\n`
    : serializeReaderAnnotationMarkdown(document);
}

export function readerAnnotationExportCount(document: ReaderAnnotationExportDocument): number {
  return document.books.reduce((total, book) => total + book.annotations.length, 0);
}

function fileSafeSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .toLocaleLowerCase()
      .slice(0, 80) || "annotations"
  );
}

export function readerAnnotationExportFileName(
  document: ReaderAnnotationExportDocument,
  format: ReaderAnnotationExportFormat,
): string {
  const base =
    document.books.length === 1
      ? `${fileSafeSlug(document.books[0]?.title ?? "annotations")}-annotations`
      : "archeion-annotations";
  return `${base}.${format === "json" ? "json" : "md"}`;
}
