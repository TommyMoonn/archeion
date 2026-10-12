import type { Rendition } from "epubjs";
import type { RuntimeSnapshot } from "./reader-runtime-observer";

type ProbeManager = {
  container: HTMLElement;
  scrollTop: number;
  check: (offsetLeft?: number, offsetTop?: number) => Promise<unknown>;
  counter: (bounds: { heightDelta: number }) => void;
  scrollBy: (x: number, y: number, silent?: boolean) => void;
  scrollTo: (x: number, y: number, silent?: boolean) => void;
  request: (...args: unknown[]) => Promise<unknown>;
  q: { enqueue: (action: () => Promise<unknown>) => Promise<unknown> };
};
export type PrependCorrection = {
  source: "counter" | "scrollBy" | "scrollTo";
  requestedY: number;
  before: RuntimeSnapshot;
  after: RuntimeSnapshot;
};

/** Opt-in private-method instrumentation for the anchoring experiment only. */
export function probeReaderPrepend(rendition: Rendition, snapshot: () => RuntimeSnapshot) {
  const manager = (rendition as Rendition & { manager: ProbeManager }).manager;
  const original = {
    counter: manager.counter,
    scrollBy: manager.scrollBy,
    scrollTo: manager.scrollTo,
    request: manager.request,
  };
  const corrections: PrependCorrection[] = [];
  let inCounter = false;
  let requestGate: Promise<void> | null = null;
  let releaseRequest: (() => void) | null = null;
  let waiting = false;
  let requestsBeforeGate = 0;
  let rejectNext = false;
  const requests: string[] = [];
  const record = (source: PrependCorrection["source"], requestedY: number, action: () => void) => {
    const before = snapshot();
    action();
    corrections.push({ source, requestedY, before, after: snapshot() });
    if (corrections.length > 1000) corrections.shift();
  };
  manager.counter = function (bounds) {
    inCounter = true;
    try {
      record("counter", bounds.heightDelta, () => original.counter.call(manager, bounds));
    } finally {
      inCounter = false;
    }
  };
  manager.scrollBy = function (x, y, silent) {
    if (inCounter) original.scrollBy.call(manager, x, y, silent);
    else record("scrollBy", y, () => original.scrollBy.call(manager, x, y, silent));
  };
  manager.scrollTo = function (x, y, silent) {
    record("scrollTo", y, () => original.scrollTo.call(manager, x, y, silent));
  };
  manager.request = async function (...args) {
    requests.push(String(args[0]));
    const gate = requestsBeforeGate === 0 ? requestGate : null;
    if (requestGate && requestsBeforeGate > 0) requestsBeforeGate -= 1;
    if (gate) {
      requestGate = null;
      waiting = true;
      await gate;
      waiting = false;
    }
    if (rejectNext) {
      rejectNext = false;
      // Send a missing synthetic archive entry through the real request owner,
      // so the production failure boundary observes the actual rejected fetch.
      return original.request.call(manager, "/EPUB/missing-synthetic-chapter.xhtml");
    }
    return original.request.apply(manager, args);
  };
  return {
    corrections: () => [...corrections],
    waiting: () => waiting,
    requests: () => [...requests],
    failNextRequest() {
      rejectNext = true;
    },
    holdNextRequest(skip = 0) {
      requestsBeforeGate = skip;
      requestGate = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
    },
    releaseRequest() {
      releaseRequest?.();
      releaseRequest = null;
    },
    // Controlled audit reproduction, not a normal-input or boundary-wakeup test.
    async atOffset(offset: number, preloadOffset?: number) {
      manager.scrollTo(0, offset, true);
      manager.scrollTop = manager.container.scrollTop;
      const before = snapshot();
      await manager.q.enqueue(() => manager.check(undefined, preloadOffset));
      return before;
    },
    dispose() {
      releaseRequest?.();
      Object.assign(manager, original);
    },
  };
}
