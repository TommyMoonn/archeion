import type { Book as EpubBook, Location } from "epubjs";

import type { ReaderChapter } from "../../types/reader";
import {
  createReaderNavigationAdapter,
  type ReaderNavigationAdapter,
  type ReaderNavigationTarget,
} from "./readerNavigationAdapter";

type NavigationTreeItem = {
  href?: unknown;
  id?: unknown;
  label?: unknown;
  subitems?: unknown;
};

type NavigationFrame = {
  depth: number;
  item: unknown;
  parentId?: string;
  path: number[];
};

type ResolvedChapter = ReaderNavigationTarget & {
  chapter: ReaderChapter;
};

export type ReaderNavigationModel = {
  readonly chapters: readonly ReaderChapter[];
  findCurrentChapter: (location: Location) => ReaderChapter | undefined;
  resolveChapterTarget: (chapterId: string) => string | undefined;
};

const EMPTY_CHAPTERS: readonly ReaderChapter[] = Object.freeze([]);

export const emptyReaderNavigationModel: ReaderNavigationModel = Object.freeze({
  chapters: EMPTY_CHAPTERS,
  findCurrentChapter: () => undefined,
  resolveChapterTarget: () => undefined,
});

export function flattenReaderNavigation(tree: unknown): ReaderChapter[] {
  if (!Array.isArray(tree)) {
    return [];
  }

  const chapters: ReaderChapter[] = [];
  const seenItems = new WeakSet<object>();
  const usedIds = new Set<string>();
  const stack: NavigationFrame[] = [];

  for (let index = tree.length - 1; index >= 0; index -= 1) {
    stack.push({ depth: 0, item: tree[index], path: [index] });
  }

  while (stack.length > 0) {
    const frame = stack.pop();

    if (!frame || !isNavigationTreeItem(frame.item) || seenItems.has(frame.item)) {
      continue;
    }

    seenItems.add(frame.item);
    const href = nonEmptyString(frame.item.href);
    let childParentId = frame.parentId;

    if (href) {
      const id = uniqueChapterId(
        nonEmptyString(frame.item.id) ??
          `chapter-${frame.path.map((index) => index + 1).join("-")}`,
        usedIds,
      );
      const chapter: ReaderChapter = {
        id,
        label: normalizedLabel(frame.item.label) ?? href,
        href,
        depth: frame.depth,
      };

      if (frame.parentId) {
        chapter.parentId = frame.parentId;
      }

      chapters.push(chapter);
      childParentId = id;
    }

    if (!Array.isArray(frame.item.subitems)) {
      continue;
    }

    for (let index = frame.item.subitems.length - 1; index >= 0; index -= 1) {
      stack.push({
        depth: frame.depth + 1,
        item: frame.item.subitems[index],
        parentId: childParentId,
        path: [...frame.path, index],
      });
    }
  }

  return chapters;
}

export async function loadReaderNavigationModel(book: EpubBook): Promise<ReaderNavigationModel> {
  try {
    const navigation = await book.loaded.navigation;
    const chapters = flattenReaderNavigation(navigation?.toc);

    if (chapters.length === 0) {
      return emptyReaderNavigationModel;
    }

    const adapter = createReaderNavigationAdapter(book);
    const targets = await adapter.resolveTargets(chapters.map((chapter) => chapter.href));
    const resolvedChapters = chapters.map<ResolvedChapter>((chapter, index) => ({
      chapter,
      ...targets[index],
    }));

    return createReaderNavigationModel(chapters, resolvedChapters, adapter);
  } catch {
    return emptyReaderNavigationModel;
  }
}

function createReaderNavigationModel(
  chapters: readonly ReaderChapter[],
  resolvedChapters: readonly ResolvedChapter[],
  adapter: ReaderNavigationAdapter,
): ReaderNavigationModel {
  const chapterById = new Map(
    resolvedChapters.map((resolvedChapter) => [resolvedChapter.chapter.id, resolvedChapter]),
  );

  return {
    chapters,
    findCurrentChapter(location) {
      const locationHref = nonEmptyString(location.start?.href);
      const locationCfi = nonEmptyString(location.start?.cfi);

      if (locationHref) {
        const locationTarget = adapter.resolveLocationTarget(locationHref);
        const sameDocumentChapters = resolvedChapters.filter(
          (chapter) => chapter.canonicalDocumentHref === locationTarget.canonicalDocumentHref,
        );

        if (locationCfi && sameDocumentChapters.length > 0) {
          const closestCfiChapter = latestChapterAtOrBefore(
            sameDocumentChapters,
            locationCfi,
            adapter,
          );

          if (closestCfiChapter) {
            return closestCfiChapter.chapter;
          }
        }

        const exactTarget = resolvedChapters.find(
          (chapter) => chapter.canonicalFullHref === locationTarget.canonicalFullHref,
        );

        if (exactTarget) {
          return exactTarget.chapter;
        }

        if (sameDocumentChapters.length > 0) {
          return sameDocumentChapters[0]?.chapter;
        }
      }

      return closestPrecedingSpineChapter(resolvedChapters, finiteNumber(location.start?.index))
        ?.chapter;
    },
    resolveChapterTarget(chapterId) {
      return chapterById.get(chapterId)?.displayTarget;
    },
  };
}

function latestChapterAtOrBefore(
  chapters: readonly ResolvedChapter[],
  locationCfi: string,
  adapter: ReaderNavigationAdapter,
): ResolvedChapter | undefined {
  let closestChapter: ResolvedChapter | undefined;

  for (const chapter of chapters) {
    const chapterCfi = chapter.position.cfi;

    if (!chapterCfi) {
      continue;
    }

    const chapterOrder = adapter.compareCfis(chapterCfi, locationCfi);

    if (chapterOrder === undefined || chapterOrder > 0) {
      continue;
    }

    if (!closestChapter) {
      closestChapter = chapter;
      continue;
    }

    const closestCfi = closestChapter.position.cfi;
    const closestOrder = closestCfi ? adapter.compareCfis(closestCfi, chapterCfi) : undefined;

    if (closestOrder === undefined || closestOrder < 0) {
      closestChapter = chapter;
    }
  }

  return closestChapter;
}

function closestPrecedingSpineChapter(
  chapters: readonly ResolvedChapter[],
  locationIndex: number | undefined,
): ResolvedChapter | undefined {
  if (locationIndex === undefined) {
    return undefined;
  }

  let closestChapter: ResolvedChapter | undefined;

  for (const chapter of chapters) {
    const spineIndex = chapter.position.spineIndex;

    if (
      spineIndex === undefined ||
      spineIndex > locationIndex ||
      (closestChapter !== undefined &&
        spineIndex <= (closestChapter.position.spineIndex ?? Number.NEGATIVE_INFINITY))
    ) {
      continue;
    }

    closestChapter = chapter;
  }

  return closestChapter;
}

function isNavigationTreeItem(value: unknown): value is NavigationTreeItem & object {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizedLabel(value: unknown): string | undefined {
  const label = nonEmptyString(value);
  return label?.replace(/\s+/g, " ");
}

function uniqueChapterId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  let duplicateIndex = 2;
  let candidate = `${baseId}-${duplicateIndex}`;

  while (usedIds.has(candidate)) {
    duplicateIndex += 1;
    candidate = `${baseId}-${duplicateIndex}`;
  }

  usedIds.add(candidate);
  return candidate;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
