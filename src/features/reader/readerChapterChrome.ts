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
