import type { Location } from "epubjs";

import type { ReaderChapter } from "../../types/reader";

export type ReaderChapterSequence = {
  current?: ReaderChapter;
  nextChapterId?: string;
  previousChapterId?: string;
};

export function deriveReaderChapterSequence(
  chapters: readonly ReaderChapter[],
  currentChapterId?: string,
): ReaderChapterSequence {
  if (chapters.length === 0) {
    return {};
  }

  const currentIndex = currentChapterId
    ? chapters.findIndex((chapter) => chapter.id === currentChapterId)
    : -1;

  if (currentIndex < 0) {
    return { nextChapterId: chapters[0]?.id };
  }

  const current = chapters[currentIndex];
  const previousChapterId = chapters[currentIndex - 1]?.id;
  const nextChapterId = chapters[currentIndex + 1]?.id;

  return {
    current,
    ...(previousChapterId ? { previousChapterId } : {}),
    ...(nextChapterId ? { nextChapterId } : {}),
  };
}

export function normalizeReaderChapterProgress(location: Location): number | undefined {
  if (location.atStart) {
    return 0;
  }

  if (location.atEnd) {
    return 100;
  }

  const displayedPage = finiteNumber(location.start?.displayed?.page);
  const displayedTotal = finiteNumber(location.start?.displayed?.total);

  if (displayedPage === undefined || displayedTotal === undefined || displayedTotal <= 0) {
    return undefined;
  }

  const percentage = (displayedPage / displayedTotal) * 100;
  return Math.round(clamp(percentage, 0, 100));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
