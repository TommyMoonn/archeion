import type { Book as EpubBook, Location } from "epubjs";

import type {
  ReaderChapter,
  ReaderLandmark,
  ReaderNavigationItem,
  ReaderPageReference,
} from "../../types/reader";
import {
  createReaderNavigationAdapter,
  type ReaderNavigationAdapter,
  type ReaderNavigationDocumentTarget,
  type ReaderNavigationTarget,
} from "./readerNavigationAdapter";
import {
  loadReaderNavigationSource,
  type ReaderPageReferenceSource,
} from "./readerNavigationSource";

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

type UnresolvedNavigationItem = {
  href: string;
  id: string;
  label: string;
};

type UnresolvedChapter = UnresolvedNavigationItem & {
  depth: number;
  parentId?: string;
};

type UnresolvedLandmark = UnresolvedNavigationItem & {
  semanticType?: string;
};

type UnresolvedPageReference = UnresolvedNavigationItem;

type ResolvedChapter = ReaderNavigationDocumentTarget & {
  chapter: ReaderChapter;
};

export type ReaderNavigationModel = {
  readonly chapters: readonly ReaderChapter[];
  readonly landmarks: readonly ReaderLandmark[];
  readonly pageReferences: readonly ReaderPageReference[];
  findCurrentChapter: (location: Location) => ReaderChapter | undefined;
  findNearestChapter: (cfi: string) => ReaderChapter | undefined;
  resolveItemTarget: (itemId: string) => string | undefined;
};

const EMPTY_CHAPTERS: readonly ReaderChapter[] = Object.freeze([]);
const EMPTY_LANDMARKS: readonly ReaderLandmark[] = Object.freeze([]);
const EMPTY_PAGE_REFERENCES: readonly ReaderPageReference[] = Object.freeze([]);

export const emptyReaderNavigationModel: ReaderNavigationModel = Object.freeze({
  chapters: EMPTY_CHAPTERS,
  landmarks: EMPTY_LANDMARKS,
  pageReferences: EMPTY_PAGE_REFERENCES,
  findCurrentChapter: () => undefined,
  findNearestChapter: () => undefined,
  resolveItemTarget: () => undefined,
});

export async function loadReaderNavigationModel(book: EpubBook): Promise<ReaderNavigationModel> {
  const source = await loadReaderNavigationSource(book);
  const usedIds = new Set<string>();
  const navigationRecord = asRecord(source.navigation);
  const unresolvedChapters = parseContents(navigationRecord?.toc, usedIds);
  const unresolvedLandmarks = parseLandmarks(navigationRecord?.landmarks, usedIds);
  const unresolvedPageReferences = parsePageReferences(source.pageReferences, usedIds);
  const unresolvedItems = [
    ...unresolvedChapters,
    ...unresolvedLandmarks,
    ...unresolvedPageReferences,
  ];

  if (unresolvedItems.length === 0) {
    return emptyReaderNavigationModel;
  }

  try {
    const adapter = createReaderNavigationAdapter(book);
    const targets = await adapter.resolveTargets(unresolvedItems.map((item) => item.href));
    const chapterTargets = targets.slice(0, unresolvedChapters.length);
    const landmarkOffset = unresolvedChapters.length;
    const pageReferenceOffset = landmarkOffset + unresolvedLandmarks.length;
    const landmarkTargets = targets.slice(landmarkOffset, pageReferenceOffset);
    const pageReferenceTargets = targets.slice(pageReferenceOffset);
    const chapters = unresolvedChapters.map((chapter, index) =>
      resolveChapter(chapter, chapterTargets[index]),
    );
    const landmarks = unresolvedLandmarks.map((landmark, index) =>
      resolveLandmark(landmark, landmarkTargets[index]),
    );
    const pageReferences = unresolvedPageReferences.map((pageReference, index) =>
      resolvePageReference(pageReference, pageReferenceTargets[index]),
    );
    const resolvedChapters = chapters.map<ResolvedChapter>((chapter, index) => ({
      chapter,
      canonicalDocumentHref: chapterTargets[index].canonicalDocumentHref,
      canonicalFullHref: chapterTargets[index].canonicalFullHref,
    }));

    return createReaderNavigationModel(
      chapters,
      landmarks,
      pageReferences,
      resolvedChapters,
      adapter,
    );
  } catch {
    return emptyReaderNavigationModel;
  }
}

function createReaderNavigationModel(
  chapters: readonly ReaderChapter[],
  landmarks: readonly ReaderLandmark[],
  pageReferences: readonly ReaderPageReference[],
  resolvedChapters: readonly ResolvedChapter[],
  adapter: ReaderNavigationAdapter,
): ReaderNavigationModel {
  const targetByItemId = new Map(
    [...chapters, ...landmarks, ...pageReferences].map((item) => [item.id, item.target]),
  );

  return {
    chapters,
    landmarks,
    pageReferences,
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
    findNearestChapter(cfi) {
      const position = adapter.resolveCfiPosition(cfi);

      if (!position) {
        return undefined;
      }

      const sameSpineChapters =
        position.spineIndex === undefined
          ? []
          : resolvedChapters.filter(
              (chapter) => chapter.chapter.position.spineIndex === position.spineIndex,
            );
      const comparableChapter = position.cfi
        ? latestChapterAtOrBefore(
            sameSpineChapters.length > 0 ? sameSpineChapters : resolvedChapters,
            position.cfi,
            adapter,
          )
        : undefined;

      if (comparableChapter) {
        return comparableChapter.chapter;
      }

      if (sameSpineChapters.length > 0) {
        return sameSpineChapters[0]?.chapter;
      }

      return closestPrecedingSpineChapter(resolvedChapters, position.spineIndex)?.chapter;
    },
    resolveItemTarget(itemId) {
      return targetByItemId.get(itemId);
    },
  };
}

function parseContents(tree: unknown, usedIds: Set<string>): UnresolvedChapter[] {
  if (!Array.isArray(tree)) {
    return [];
  }

  const chapters: UnresolvedChapter[] = [];
  const seenItems = new WeakSet<object>();
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
      const id = uniqueNavigationItemId(
        nonEmptyString(frame.item.id) ??
          `chapter-${frame.path.map((index) => index + 1).join("-")}`,
        usedIds,
      );
      const chapter: UnresolvedChapter = {
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

function parseLandmarks(value: unknown, usedIds: Set<string>): UnresolvedLandmark[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const landmarks: UnresolvedLandmark[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = asRecord(value[index]);
    const href = nonEmptyString(item?.href);

    if (!item || !href) {
      continue;
    }

    const semanticType = nonEmptyString(item.type);
    const landmark: UnresolvedLandmark = {
      id: uniqueNavigationItemId(nonEmptyString(item.id) ?? `landmark-${index + 1}`, usedIds),
      label: normalizedLabel(item.label) ?? semanticType ?? href,
      href,
    };

    if (semanticType) {
      landmark.semanticType = semanticType;
    }

    landmarks.push(landmark);
  }

  return landmarks;
}

function parsePageReferences(
  entries: readonly ReaderPageReferenceSource[],
  usedIds: Set<string>,
): UnresolvedPageReference[] {
  const pageReferences: UnresolvedPageReference[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];
    const href = nonEmptyString(item?.href);
    const label = normalizedLabel(item?.label);

    if (!item || !href || !label) {
      continue;
    }

    pageReferences.push({
      id: uniqueNavigationItemId(nonEmptyString(item.id) ?? `page-reference-${index + 1}`, usedIds),
      label,
      href,
    });
  }

  return pageReferences;
}

function resolveChapter(chapter: UnresolvedChapter, target: ReaderNavigationTarget): ReaderChapter {
  return {
    ...chapter,
    ...resolvedItemFields(target),
  };
}

function resolveLandmark(
  landmark: UnresolvedLandmark,
  target: ReaderNavigationTarget,
): ReaderLandmark {
  return {
    ...landmark,
    ...resolvedItemFields(target),
  };
}

function resolvePageReference(
  pageReference: UnresolvedPageReference,
  target: ReaderNavigationTarget,
): ReaderPageReference {
  return {
    ...pageReference,
    ...resolvedItemFields(target),
  };
}

function resolvedItemFields(
  target: ReaderNavigationTarget,
): Pick<ReaderNavigationItem, "position" | "target"> {
  return {
    position: target.position,
    target: target.displayTarget,
  };
}

function latestChapterAtOrBefore(
  chapters: readonly ResolvedChapter[],
  locationCfi: string,
  adapter: ReaderNavigationAdapter,
): ResolvedChapter | undefined {
  let closestChapter: ResolvedChapter | undefined;

  for (const chapter of chapters) {
    const chapterCfi = chapter.chapter.position.cfi;

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

    const closestCfi = closestChapter.chapter.position.cfi;
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
    const spineIndex = chapter.chapter.position.spineIndex;

    if (
      spineIndex === undefined ||
      spineIndex > locationIndex ||
      (closestChapter !== undefined &&
        spineIndex <= (closestChapter.chapter.position.spineIndex ?? Number.NEGATIVE_INFINITY))
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizedLabel(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }

  const label = nonEmptyString(value);
  return label?.replace(/\s+/g, " ");
}

function uniqueNavigationItemId(baseId: string, usedIds: Set<string>): string {
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
