import type { Rendition } from "epubjs";

import { getContinuousReaderWheelDelta } from "./readerNavigation";

type ContinuousRenditionManager = {
  container?: HTMLElement;
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

export function stabilizeContinuousRendition(
  rendition: RenditionWithManager,
  ownsSession: () => boolean,
): () => void {
  const manager = rendition.manager;

  if (!manager) {
    return () => undefined;
  }

  // epub.js 0.3.93 owns prepend compensation through counter(). Chromium must
  // not independently anchor the same outer scroller. The attached event runs
  // before display; started alone does not guarantee the container exists yet.
  const configureScroller = () => {
    if (ownsSession() && manager.container) {
      manager.container.style.overflowAnchor = "none";
    }
  };
  rendition.on("attached", configureScroller);
  configureScroller();

  // Keep loaded views visible and mounted. epub.js's stock update destroys
  // offscreen iframes, which loses their input listeners and can leave an empty
  // placeholder while the iframe is recreated during reverse scrolling.
  manager.update = async () => {
    if (!ownsSession()) return;
    const views = manager.views?.all() ?? [];

    await Promise.all(
      views.map(async (view) => {
        if (!ownsSession()) return;
        if (!view.displayed) {
          await view.display(manager.request);
        }
        if (ownsSession()) view.show();
      }),
    );
  };

  return () => rendition.off("attached", configureScroller);
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
