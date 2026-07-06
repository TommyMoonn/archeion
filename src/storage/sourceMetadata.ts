import type { EpubSourceMetadata } from "../types/book";

const SOURCE_METADATA_FIELDS = [
  "title",
  "creator",
  "identifier",
  "language",
] as const satisfies readonly (keyof EpubSourceMetadata)[];

function cleanMetadataValue(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();

  return cleaned || undefined;
}

export function normalizeSourceMetadata(
  metadata: EpubSourceMetadata | undefined,
): EpubSourceMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const cleaned: EpubSourceMetadata = {};

  for (const field of SOURCE_METADATA_FIELDS) {
    const value = cleanMetadataValue(metadata[field]);

    if (value) {
      cleaned[field] = value;
    }
  }

  return Object.keys(cleaned).length ? cleaned : undefined;
}

export function sourceMetadataEqual(
  left: EpubSourceMetadata | undefined,
  right: EpubSourceMetadata | undefined,
): boolean {
  const normalizedLeft = normalizeSourceMetadata(left);
  const normalizedRight = normalizeSourceMetadata(right);

  return SOURCE_METADATA_FIELDS.every(
    (field) => normalizedLeft?.[field] === normalizedRight?.[field],
  );
}
