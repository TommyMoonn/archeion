import type { Rendition } from "epubjs";

import { getContinuousReaderWheelDelta } from "./readerNavigation";

type ContinuousRenditionManager = {
  check?: (...args: unknown[]) => Promise<unknown>;
  counter?: (bounds: unknown) => void;
  request?: unknown;
  update?: (offset?: number) => Promise<unknown>;
  views?: {
    all: () => ContinuousRenditionView[];
  };
};

type ContinuousRenditionView = {
  display: (request: unknown) => Promise<unknown>;
  displayed: boolean;
  show: () => void;
};

export type RenditionWithManager = Rendition & {
  manager?: ContinuousRenditionManager;
  started?: Promise<void>;
};

export type ReaderStageSize = Readonly<{
  height: number;
  width: number;
}>;

export function stabilizeContinuousRendition(rendition: RenditionWithManager): void {
  const manager = rendition.manager;

  if (!manager) {
    return;
  }

  // Keep loaded views visible and mounted. epub.js's stock update destroys
  // offscreen iframes, which loses their input listeners and can leave an empty
  // placeholder while the iframe is recreated during reverse scrolling.
  manager.update = async () => {
    const views = manager.views?.all() ?? [];

    await Promise.all(
      views.map(async (view) => {
        if (!view.displayed) {
          await view.display(manager.request);
        }
        view.show();
      }),
    );
  };

  const originalCheck = manager.check?.bind(manager);
  const originalCounter = manager.counter?.bind(manager);
  let activeChecks = 0;

  if (originalCheck) {
    manager.check = async (...args: unknown[]) => {
      activeChecks += 1;
      try {
        return await originalCheck(...args);
      } finally {
        activeChecks -= 1;
      }
    };
  }

  if (originalCounter) {
    manager.counter = (bounds: unknown) => {
      if (activeChecks > 0) {
        originalCounter(bounds);
      }
    };
  }
}

export function syncContinuousRenditionStageSize(
  rendition: RenditionWithManager,
  stageSize: ReaderStageSize,
): void {
  if (!isUsableReaderStageSize(stageSize)) return;
  rendition.resize(stageSize.width, stageSize.height);
}

export function observeReaderStageSize(
  stage: HTMLElement,
  onSize: (size: ReaderStageSize) => void,
): () => void {
  let lastSize: ReaderStageSize | null = null;

  const publish = (width: number, height: number) => {
    const nextSize = normalizeReaderStageSize(width, height);
    if (!nextSize || sameReaderStageSize(lastSize, nextSize)) return;
    lastSize = nextSize;
    onSize(nextSize);
  };
  const publishStageBounds = () => {
    const bounds = stage.getBoundingClientRect();
    publish(bounds.width, bounds.height);
  };

  publishStageBounds();

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === stage);
      if (entry) publish(entry.contentRect.width, entry.contentRect.height);
      else publishStageBounds();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }

  window.addEventListener("resize", publishStageBounds);
  return () => window.removeEventListener("resize", publishStageBounds);
}

function normalizeReaderStageSize(width: number, height: number): ReaderStageSize | null {
  const normalized = Object.freeze({
    height: Math.round(height),
    width: Math.round(width),
  });
  return isUsableReaderStageSize(normalized) ? normalized : null;
}

function isUsableReaderStageSize(size: ReaderStageSize): boolean {
  return (
    Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
  );
}

function sameReaderStageSize(left: ReaderStageSize | null, right: ReaderStageSize): boolean {
  return left?.width === right.width && left.height === right.height;
}

export function forwardContinuousWheel(event: WheelEvent, scroller: HTMLElement | null): boolean {
  const deltaY = getContinuousReaderWheelDelta(event);

  if (!scroller || deltaY === null) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  scroller.scrollTop += deltaY;
  return true;
}
