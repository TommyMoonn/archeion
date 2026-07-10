import type { Location } from "epubjs";

import type { ReaderNavigationState } from "../../types/reader";
import { emptyReaderNavigationModel, type ReaderNavigationModel } from "./readerNavigationModel";

export type ReaderNavigationStateController = {
  getModel: () => ReaderNavigationModel;
  getState: () => ReaderNavigationState;
  relocate: (location: Location) => void;
  reset: () => void;
  setModel: (model: ReaderNavigationModel) => void;
};

export function createReaderNavigationStateController(
  onChange: (state: ReaderNavigationState) => void,
): ReaderNavigationStateController {
  let model = emptyReaderNavigationModel;
  let state: ReaderNavigationState = { chapters: model.chapters, status: "loading" };
  let lastLocation: Location | null = null;
  let ready = false;

  function publish(nextState: ReaderNavigationState) {
    if (readerNavigationStatesEqual(state, nextState)) return;
    state = nextState;
    onChange(state);
  }

  function publishReadyState() {
    const currentChapterId = lastLocation ? model.findCurrentChapter(lastLocation)?.id : undefined;
    const chapterProgress =
      currentChapterId && lastLocation ? normalizeReaderChapterProgress(lastLocation) : undefined;

    publish({
      chapters: model.chapters,
      status: "ready",
      ...(currentChapterId ? { currentChapterId } : {}),
      ...(chapterProgress !== undefined ? { chapterProgress } : {}),
    });
  }

  return {
    getModel: () => model,
    getState: () => state,
    relocate(location) {
      lastLocation = location;
      if (ready) publishReadyState();
    },
    reset() {
      model = emptyReaderNavigationModel;
      lastLocation = null;
      ready = false;
      publish({ chapters: model.chapters, status: "loading" });
    },
    setModel(nextModel) {
      model = nextModel;
      ready = true;
      publishReadyState();
    },
  };
}

export function normalizeReaderChapterProgress(location: Location): number | undefined {
  if (location.atStart) return 0;
  if (location.atEnd) return 100;

  const displayedPage = finiteNumber(location.start?.displayed?.page);
  const displayedTotal = finiteNumber(location.start?.displayed?.total);

  if (displayedPage === undefined || displayedTotal === undefined || displayedTotal <= 0) {
    return undefined;
  }

  return Math.round(clamp((displayedPage / displayedTotal) * 100, 0, 100));
}

function readerNavigationStatesEqual(
  left: ReaderNavigationState,
  right: ReaderNavigationState,
): boolean {
  return (
    left.chapters === right.chapters &&
    left.currentChapterId === right.currentChapterId &&
    left.chapterProgress === right.chapterProgress &&
    left.status === right.status
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
