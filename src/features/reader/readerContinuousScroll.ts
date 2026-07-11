import type { Rendition } from "epubjs";

import { getReaderWheelDelta } from "./readerNavigation";

const CONTINUOUS_RETENTION_VIEWPORTS = 2;

type ContinuousRenditionManager = {
  check?: (...args: unknown[]) => Promise<unknown>;
  container?: HTMLElement;
  counter?: (bounds: unknown) => void;
  settings?: {
    offset?: number;
  };
  update?: (offset?: number) => Promise<unknown>;
};

export type RenditionWithManager = Rendition & {
  manager?: ContinuousRenditionManager;
  started?: Promise<void>;
};

function retentionOffset(manager: ContinuousRenditionManager, requestedOffset?: number): number {
  const configuredOffset = requestedOffset ?? manager.settings?.offset ?? 0;
  const viewportRetention = (manager.container?.clientHeight ?? 0) * CONTINUOUS_RETENTION_VIEWPORTS;
  return Math.max(configuredOffset, viewportRetention);
}

export function stabilizeContinuousRendition(rendition: RenditionWithManager): void {
  const manager = rendition.manager;

  if (!manager) {
    return;
  }

  const originalUpdate = manager.update?.bind(manager);
  if (originalUpdate) {
    manager.update = (offset) => originalUpdate(retentionOffset(manager, offset));
  }

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
  const deltaY = getReaderWheelDelta(event);

  if (!scroller || deltaY === null) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  scroller.scrollTop += deltaY;
  return true;
}
