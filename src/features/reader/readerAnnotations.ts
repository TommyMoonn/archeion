import type { Annotation } from "../../types/annotation";
import type { ReaderChapter } from "../../types/reader";
import {
  createSearchQuery,
  createSearchTextVariants,
  searchFieldsMatchQuery,
  type SearchQuery,
} from "../../utils/searchText";

export const READER_ANNOTATION_VIEWS = ["all", "bookmarks", "highlights", "notes"] as const;
export const READER_ANNOTATION_SORTS = ["book-order", "recent"] as const;

export type ReaderAnnotationView = (typeof READER_ANNOTATION_VIEWS)[number];
export type ReaderAnnotationSort = (typeof READER_ANNOTATION_SORTS)[number];

export type ReaderAnnotationGroup = {
  annotations: Annotation[];
  key: string;
  label: string;
};

type ChapterDescriptor = {
  key: string;
  label: string;
  order: number;
};

const cfiCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function decodeHref(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeReaderChapterHref(href: string, includeFragment = true): string {
  const normalized = decodeHref(href.trim())
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
  const withoutQuery = normalized.split("?", 1)[0] ?? normalized;
  return includeFragment ? withoutQuery : (withoutQuery.split("#", 1)[0] ?? withoutQuery);
}

function chapterFallbackLabel(href: string): string {
  const documentHref = normalizeReaderChapterHref(href, false);
  const fileName = documentHref.split("/").pop() ?? documentHref;
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const label = withoutExtension.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return label
    ? label.replace(/\b\w/g, (character) => character.toLocaleUpperCase())
    : "Other locations";
}

function buildChapterLookup(chapters: readonly ReaderChapter[]) {
  const exact = new Map<string, ChapterDescriptor>();
  const byDocument = new Map<string, ChapterDescriptor>();

  chapters.forEach((chapter, order) => {
    const descriptor = { key: chapter.id, label: chapter.label, order };
    const exactHref = normalizeReaderChapterHref(chapter.href);
    const documentHref = normalizeReaderChapterHref(chapter.href, false);
    if (exactHref && !exact.has(exactHref)) exact.set(exactHref, descriptor);
    if (documentHref && !byDocument.has(documentHref)) byDocument.set(documentHref, descriptor);
  });

  return { byDocument, exact };
}

function annotationChapter(
  annotation: Annotation,
  chapters: ReturnType<typeof buildChapterLookup>,
): ChapterDescriptor {
  const href = nonEmptyText(annotation.chapterHref);
  if (href) {
    const exactHref = normalizeReaderChapterHref(href);
    const documentHref = normalizeReaderChapterHref(href, false);
    const matched = chapters.exact.get(exactHref) ?? chapters.byDocument.get(documentHref);
    if (matched) return matched;

    return {
      key: `href:${documentHref || exactHref}`,
      label: chapterFallbackLabel(href),
      order: Number.MAX_SAFE_INTEGER - 1,
    };
  }

  return {
    key: "other-locations",
    label:
      annotation.type === "bookmark"
        ? (nonEmptyText(annotation.label) ?? "Other locations")
        : "Other locations",
    order: Number.MAX_SAFE_INTEGER,
  };
}

function matchesView(annotation: Annotation, view: ReaderAnnotationView): boolean {
  if (view === "all") return true;
  if (view === "bookmarks") return annotation.type === "bookmark";
  if (view === "highlights") return annotation.type === "highlight";
  return annotation.type === "highlight" && Boolean(nonEmptyText(annotation.note));
}

function matchesQuery(annotation: Annotation, query: SearchQuery): boolean {
  return searchFieldsMatchQuery(
    [createSearchTextVariants(annotation.selectedText), createSearchTextVariants(annotation.note)],
    query,
  );
}

function compareBookOrder(
  left: Annotation,
  right: Annotation,
  chapterLookup: ReturnType<typeof buildChapterLookup>,
): number {
  const leftChapter = annotationChapter(left, chapterLookup);
  const rightChapter = annotationChapter(right, chapterLookup);
  const chapterOrder = leftChapter.order - rightChapter.order;
  if (chapterOrder !== 0) return chapterOrder;

  const cfiOrder = cfiCollator.compare(left.cfiRange ?? "", right.cfiRange ?? "");
  if (cfiOrder !== 0) return cfiOrder;

  const createdOrder = left.createdAt.localeCompare(right.createdAt);
  return createdOrder !== 0 ? createdOrder : left.id.localeCompare(right.id);
}

function compareRecent(left: Annotation, right: Annotation): number {
  const updatedOrder = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedOrder !== 0) return updatedOrder;
  const createdOrder = right.createdAt.localeCompare(left.createdAt);
  return createdOrder !== 0 ? createdOrder : left.id.localeCompare(right.id);
}

export function visibleReaderAnnotations({
  annotations,
  chapters,
  query,
  sort,
  view,
}: {
  annotations: readonly Annotation[];
  chapters: readonly ReaderChapter[];
  query: string;
  sort: ReaderAnnotationSort;
  view: ReaderAnnotationView;
}): Annotation[] {
  const chapterLookup = buildChapterLookup(chapters);
  const searchQuery = createSearchQuery(query);
  return annotations
    .filter((annotation) => matchesView(annotation, view) && matchesQuery(annotation, searchQuery))
    .sort((left, right) =>
      sort === "recent" ? compareRecent(left, right) : compareBookOrder(left, right, chapterLookup),
    );
}

export function groupReaderAnnotations(
  annotations: readonly Annotation[],
  chapters: readonly ReaderChapter[],
): ReaderAnnotationGroup[] {
  const chapterLookup = buildChapterLookup(chapters);
  const groups = new Map<string, ReaderAnnotationGroup>();

  for (const annotation of annotations) {
    const chapter = annotationChapter(annotation, chapterLookup);
    const existing = groups.get(chapter.key);
    if (existing) {
      existing.annotations.push(annotation);
    } else {
      groups.set(chapter.key, {
        annotations: [annotation],
        key: chapter.key,
        label: chapter.label,
      });
    }
  }

  return [...groups.values()];
}

export function readerAnnotationLabel(annotation: Annotation): string {
  if (annotation.type === "bookmark") return nonEmptyText(annotation.label) ?? "Bookmark";
  if (annotation.type === "highlight") return "Highlight";
  return "Highlight";
}

export function readerAnnotationRemoveLabel(annotation: Annotation): string {
  if (annotation.type === "bookmark") return "Remove bookmark";
  if (annotation.type === "highlight") return "Remove highlight";
  return "Remove highlight";
}

export function readerAnnotationEmptyLabel(view: ReaderAnnotationView): string {
  if (view === "bookmarks") return "No bookmarks";
  if (view === "highlights") return "No highlights";
  if (view === "notes") return "No notes";
  return "No annotations";
}
