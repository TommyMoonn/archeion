import type { Annotation } from "../../types/annotation";
import type { ReaderChapter } from "../../types/reader";
import {
  createSearchQuery,
  createSearchTextVariants,
  isEmptySearchQuery,
  searchFieldsMatchQuery,
  type SearchQuery,
} from "../../utils/searchText";

export const READER_ANNOTATION_VIEWS = ["all", "bookmarks", "highlights"] as const;
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

type ReaderAnnotationProjection = {
  annotation: Annotation;
  chapter?: ChapterDescriptor;
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
    const descriptor = {
      key: chapter.id,
      label: nonEmptyText(chapter.label) ?? chapterFallbackLabel(chapter.href),
      order,
    };
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

export function readerAnnotationChapterLabel(
  annotation: Annotation,
  chapters: readonly ReaderChapter[],
): string {
  return annotationChapter(annotation, buildChapterLookup(chapters)).label;
}

function matchesView(annotation: Annotation, view: ReaderAnnotationView): boolean {
  if (view === "all") return true;
  if (view === "bookmarks") return annotation.type === "bookmark";
  return annotation.type === "highlight";
}

function matchesQuery(
  annotation: Annotation,
  chapter: ChapterDescriptor,
  query: SearchQuery,
): boolean {
  if (isEmptySearchQuery(query)) return true;

  const fields = [createSearchTextVariants(chapter.label)];
  if (annotation.type === "bookmark") {
    fields.push(createSearchTextVariants(annotation.label));
  } else {
    fields.push(
      createSearchTextVariants(annotation.selectedText),
      createSearchTextVariants(annotation.note),
    );
  }

  return searchFieldsMatchQuery(fields, query);
}

function compareBookOrder(
  left: ReaderAnnotationProjection,
  right: ReaderAnnotationProjection,
): number {
  const chapterOrder = (left.chapter?.order ?? 0) - (right.chapter?.order ?? 0);
  if (chapterOrder !== 0) return chapterOrder;

  const cfiOrder = cfiCollator.compare(
    left.annotation.cfiRange ?? "",
    right.annotation.cfiRange ?? "",
  );
  if (cfiOrder !== 0) return cfiOrder;

  const createdOrder = left.annotation.createdAt.localeCompare(right.annotation.createdAt);
  return createdOrder !== 0 ? createdOrder : left.annotation.id.localeCompare(right.annotation.id);
}

function compareRecent(
  left: ReaderAnnotationProjection,
  right: ReaderAnnotationProjection,
): number {
  const updatedOrder = right.annotation.updatedAt.localeCompare(left.annotation.updatedAt);
  if (updatedOrder !== 0) return updatedOrder;
  const createdOrder = right.annotation.createdAt.localeCompare(left.annotation.createdAt);
  return createdOrder !== 0 ? createdOrder : left.annotation.id.localeCompare(right.annotation.id);
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
  const hasQuery = !isEmptySearchQuery(searchQuery);
  const needsChapter = hasQuery || sort === "book-order";
  return annotations
    .filter((annotation) => matchesView(annotation, view))
    .map((annotation): ReaderAnnotationProjection => {
      const chapter = needsChapter ? annotationChapter(annotation, chapterLookup) : undefined;
      return { annotation, chapter };
    })
    .filter(
      ({ annotation, chapter }) =>
        !hasQuery || (chapter ? matchesQuery(annotation, chapter, searchQuery) : false),
    )
    .sort((left, right) =>
      sort === "recent" ? compareRecent(left, right) : compareBookOrder(left, right),
    )
    .map(({ annotation }) => annotation);
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
  return "Highlight";
}

export function readerAnnotationRemoveLabel(annotation: Annotation): string {
  if (annotation.type === "bookmark") return "Remove bookmark";
  return "Remove highlight";
}

export function readerAnnotationRemovalPrompt(annotation: Annotation): string {
  if (annotation.type === "highlight" && annotation.note?.trim()) {
    return "Remove highlight and its attached note?";
  }
  return `${readerAnnotationRemoveLabel(annotation)}?`;
}

export function readerAnnotationEmptyLabel(view: ReaderAnnotationView): string {
  if (view === "bookmarks") return "No bookmarks";
  if (view === "highlights") return "No highlights";
  return "No annotations";
}
