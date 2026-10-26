import type { ReadonlyBook } from "../../types/book";
import { commonMetadataValue, commonTagsValue } from "../../storage/bulkMetadata";
export type BulkMetadataField = "series" | "publisher" | "language" | "subjects";
export const BULK_METADATA_DESCRIPTION =
  "Choose only the fields you intend to change. Unchecked metadata remains untouched.";
export function initialBulkMetadata(books: readonly ReadonlyBook[]) {
  const common = {
    series: commonMetadataValue(books, "series"),
    publisher: commonMetadataValue(books, "publisher"),
    language: commonMetadataValue(books, "language"),
    subjects: commonTagsValue(books),
  };
  return {
    common,
    values: {
      series: common.series.value,
      publisher: common.publisher.value,
      language: common.language.value,
      subjects: common.subjects.value.join("\n"),
    },
  };
}
