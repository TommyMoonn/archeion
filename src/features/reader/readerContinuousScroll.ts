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
