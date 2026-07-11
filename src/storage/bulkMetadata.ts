import type {
  Book,
  BulkMetadataEditInput,
  EpubMetadataWritebackInput,
  EpubSourceMetadata,
} from "../types/book";

export type BulkMetadataPreviewChange = {
  field: "series" | "publisher" | "language" | "subjects";
  from: string;
  label: string;
  to: string;
};

export type BulkMetadataBookPreview = {
  book: Book;
  changes: BulkMetadataPreviewChange[];
};

function cleanScalar(value: string | null): string | undefined {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

export function normalizeBulkMetadataTags(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.replace(/\s+/g, " ").trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export function parseBulkMetadataSubjects(value: string): string[] {
  return normalizeBulkMetadataTags(value.split(/\r\n|\n|\r/));
}

export function bulkMetadataSubjectsEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const normalizedLeft = normalizeBulkMetadataTags(left ?? []);
  const normalizedRight = normalizeBulkMetadataTags(right ?? []);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function applyTagEdit(
  current: readonly string[],
  edit: NonNullable<BulkMetadataEditInput["subjects"]>,
) {
  const existing = normalizeBulkMetadataTags(current);
  const values = normalizeBulkMetadataTags(edit.values);
  if (edit.mode === "replace") return values;
  const editKeys = new Set(values.map((value) => value.toLocaleLowerCase()));
  if (edit.mode === "remove") {
    return existing.filter((value) => !editKeys.has(value.toLocaleLowerCase()));
  }
  return normalizeBulkMetadataTags([...existing, ...values]);
}

export function metadataAfterBulkEdit(
  metadata: EpubSourceMetadata | undefined,
  edits: BulkMetadataEditInput,
): EpubMetadataWritebackInput {
  const current: EpubMetadataWritebackInput = { ...metadata };
  delete (current as EpubSourceMetadata).identifier;
  const next: EpubMetadataWritebackInput = { ...current };
  if (Object.hasOwn(edits, "series")) next.series = cleanScalar(edits.series ?? null);
  if (Object.hasOwn(edits, "publisher")) next.publisher = cleanScalar(edits.publisher ?? null);
  if (Object.hasOwn(edits, "language")) next.language = cleanScalar(edits.language ?? null);
  if (edits.subjects) next.subjects = applyTagEdit(current.subjects ?? [], edits.subjects);
  return next;
}

function displayScalar(value: string | undefined) {
  return value?.trim() || "Not set";
}

function displaySubjects(values: readonly string[] | undefined) {
  const normalized = normalizeBulkMetadataTags(values ?? []);
  return normalized.length ? normalized.map((value) => `“${value}”`).join("\n") : "No tags";
}

export function previewBulkMetadataBookEdit(
  book: Book,
  edits: BulkMetadataEditInput,
): BulkMetadataBookPreview {
  const current = book.sourceMetadata ?? {};
  const next = metadataAfterBulkEdit(current, edits);
  const changes: BulkMetadataPreviewChange[] = [];
  for (const [field, label] of [
    ["series", "Series"],
    ["publisher", "Publisher"],
    ["language", "Language"],
  ] as const) {
    if (Object.hasOwn(edits, field) && cleanScalar(current[field] ?? null) !== next[field]) {
      changes.push({
        field,
        label,
        from: displayScalar(current[field]),
        to: displayScalar(next[field]),
      });
    }
  }
  if (edits.subjects && !bulkMetadataSubjectsEqual(current.subjects, next.subjects)) {
    changes.push({
      field: "subjects",
      label: "Tags",
      from: displaySubjects(current.subjects),
      to: displaySubjects(next.subjects),
    });
  }
  return { book, changes };
}

export function previewBulkMetadataEdit(
  books: readonly Book[],
  edits: BulkMetadataEditInput,
): BulkMetadataBookPreview[] {
  return books.map((book) => previewBulkMetadataBookEdit(book, edits));
}

export function commonMetadataValue(
  books: readonly Book[],
  field: "series" | "publisher" | "language",
): { mixed: boolean; value: string } {
  const values = books.map((book) => book.sourceMetadata?.[field]?.trim() ?? "");
  const uniqueValues = new Set(values);
  return { mixed: uniqueValues.size > 1, value: uniqueValues.size === 1 ? values[0] : "" };
}

export function commonTagsValue(books: readonly Book[]) {
  const values = books.map((book) =>
    normalizeBulkMetadataTags(book.sourceMetadata?.subjects ?? []),
  );
  const first = values[0] ?? [];
  const mixed = values.slice(1).some((value) => !bulkMetadataSubjectsEqual(first, value));
  return {
    mixed,
    value: mixed ? [] : first,
  };
}
