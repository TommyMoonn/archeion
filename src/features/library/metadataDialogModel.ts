import type { EpubMetadataWritebackInput, ReadonlyEpubSourceMetadata } from "../../types/book";
export const EDITABLE_FIELDS = [
  ["title", "Title"],
  ["creator", "Author"],
  ["language", "Language"],
  ["publisher", "Publisher"],
  ["date", "Date"],
  ["description", "Description"],
  ["subjects", "Subjects"],
  ["series", "Series"],
  ["volume", "Volume"],
] as const satisfies readonly [keyof EpubMetadataWritebackInput, string][];

export type EditableField = (typeof EDITABLE_FIELDS)[number][0];
export type ReferenceField = "identifier";
export type MetadataField = EditableField | ReferenceField;

export const FIELD_LABELS: Record<MetadataField, string> = {
  ...Object.fromEntries(EDITABLE_FIELDS),
  identifier: "Identifier",
} as Record<MetadataField, string>;

export const FIELD_INPUT_NAMES = {
  title: "archeion-epub-metadata-title",
  creator: "archeion-epub-metadata-author",
  language: "archeion-epub-metadata-language",
  publisher: "archeion-epub-metadata-publisher",
  date: "archeion-epub-metadata-date",
  description: "archeion-epub-metadata-description",
  subjects: "archeion-epub-metadata-subjects",
  series: "archeion-epub-metadata-series",
  volume: "archeion-epub-metadata-volume",
} as const satisfies Record<EditableField, string>;

export const DISABLE_INPUT_ASSISTANCE = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const;

export const METADATA_FIELD_GROUPS = [
  {
    title: "Core metadata",
    fields: ["title", "creator", "language", "identifier"],
  },
  {
    title: "Publishing metadata",
    fields: ["publisher", "date"],
  },
  {
    title: "Series metadata",
    fields: ["series", "volume"],
  },
  {
    title: "Tags and description",
    fields: ["subjects", "description"],
  },
] as const satisfies readonly {
  title: string;
  fields: readonly MetadataField[];
}[];

export type MetadataFieldGroupDefinition = (typeof METADATA_FIELD_GROUPS)[number];

export type MetadataFormState = Record<Exclude<EditableField, "subjects">, string> & {
  subjects: string;
};

function subjectsToFormValue(subjects: readonly string[] | undefined): string {
  return subjects?.join("\n") ?? "";
}

export function formStateFromMetadata(
  metadata: ReadonlyEpubSourceMetadata | undefined,
): MetadataFormState {
  return {
    title: metadata?.title ?? "",
    creator: metadata?.creator ?? "",
    language: metadata?.language ?? "",
    publisher: metadata?.publisher ?? "",
    date: metadata?.date ?? "",
    description: metadata?.description ?? "",
    subjects: subjectsToFormValue(metadata?.subjects),
    series: metadata?.series ?? "",
    volume: metadata?.volume ?? "",
  };
}
