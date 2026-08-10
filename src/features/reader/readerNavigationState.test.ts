import type { Location } from "epubjs";
import { describe, expect, it, vi } from "vitest";

import type { ReaderChapter, ReaderLandmark, ReaderPageReference } from "../../types/reader";
import type { ReaderNavigationModel } from "./readerNavigationModel";
import { createReaderNavigationStateController } from "./readerNavigationState";

const chapter: ReaderChapter = {
  id: "chapter-1",
  label: "Chapter 1",
  href: "chapter-1.xhtml",
  target: "chapter-1.xhtml",
  position: { spineIndex: 0 },
  depth: 0,
};

const landmark: ReaderLandmark = {
  id: "landmark-1",
  label: "Body",
  href: "chapter-1.xhtml",
  target: "chapter-1.xhtml",
  position: { spineIndex: 0 },
  semanticType: "bodymatter",
};

const pageReference: ReaderPageReference = {
  id: "page-reference-1",
  label: "1",
  href: "chapter-1.xhtml#page-1",
  target: "chapter-1.xhtml#page-1",
  position: { spineIndex: 0 },
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
    landmarks: [landmark],
    pageReferences: [pageReference],
    findCurrentChapter: vi.fn(() => chapter),
    findNearestChapter: vi.fn(() => chapter),
    resolveItemTarget: vi.fn(() => chapter.target),
  };
}

describe("reader navigation state controller", () => {
  it("publishes all navigation collections and applies the last relocation once ready", () => {
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
      landmarks: model.landmarks,
      pageReferences: model.pageReferences,
      status: "ready",
    });
  });

  it("suppresses identical publications and resets session navigation state", () => {
    const onChange = vi.fn();
    const controller = createReaderNavigationStateController(onChange);
    const model = navigationModel();

    controller.setModel(model);
    controller.relocate(location(1));
    controller.relocate(location(1));

    expect(onChange).toHaveBeenCalledTimes(2);
    controller.reset();
    expect(controller.getState()).toEqual({
      chapters: [],
      landmarks: [],
      pageReferences: [],
      status: "loading",
    });
    expect(controller.getModel().resolveItemTarget(chapter.id)).toBeUndefined();
  });
});
