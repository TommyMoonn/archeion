import type { Location } from "epubjs";
import { describe, expect, it, vi } from "vitest";

import type { ReaderChapter } from "../../types/reader";
import type { ReaderNavigationModel } from "./readerNavigationModel";
import { createReaderNavigationStateController } from "./readerNavigationState";

const chapter: ReaderChapter = {
  id: "chapter-1",
  label: "Chapter 1",
  href: "chapter-1.xhtml",
  depth: 0,
};

function location(page: number): Location {
  return {
    start: {
      href: chapter.href,
      cfi: `epubcfi(/6/2!/4/2:${page})`,
      index: 0,
      location: page,
      percentage: page / 4,
      displayed: { page, total: 4 },
    },
    end: {},
    atEnd: false,
    atStart: false,
  } as Location;
}

function navigationModel(): ReaderNavigationModel {
  return {
    chapters: [chapter],
    findCurrentChapter: vi.fn(() => chapter),
    resolveChapterTarget: vi.fn(() => chapter.href),
  };
}

describe("reader navigation state controller", () => {
  it("applies the last relocation once navigation becomes ready", () => {
    const onChange = vi.fn();
    const controller = createReaderNavigationStateController(onChange);
    const model = navigationModel();

    controller.relocate(location(2));
    expect(onChange).not.toHaveBeenCalled();

    controller.setModel(model);
    expect(onChange).toHaveBeenLastCalledWith({
      chapterProgress: 50,
      chapters: model.chapters,
      currentChapterId: chapter.id,
      status: "ready",
    });
  });

  it("suppresses identical chapter publications and resets session state", () => {
    const onChange = vi.fn();
    const controller = createReaderNavigationStateController(onChange);
    const model = navigationModel();

    controller.setModel(model);
    controller.relocate(location(1));
    controller.relocate(location(1));

    expect(onChange).toHaveBeenCalledTimes(2);
    controller.reset();
    expect(controller.getState()).toEqual({ chapters: [], status: "loading" });
    expect(controller.getModel().resolveChapterTarget(chapter.id)).toBeUndefined();
  });
});
