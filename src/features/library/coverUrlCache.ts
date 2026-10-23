import { decodeCoverImage } from "./decodeCoverImage";

type CoverUrlEntry = {
  scope: string;
  promise: Promise<string | undefined>;
  revokeTimer: ReturnType<typeof setTimeout> | null;
  controller: AbortController;
  url?: string;
  image?: HTMLImageElement;
  bytes: number;
  cancelQueued?: () => void;
  priorities: Map<symbol, { priority: CoverLoadPriority; distance: number }>;
};

type CoverLoadTask = {
  entry: CoverUrlEntry;
  run: () => Promise<string | undefined>;
  resolve: (value: string | undefined) => void;
};

const MAX_CONCURRENT_COVER_LOADS = 4;
// Reserve half of the non-cancellable file/decode capacity for visible work.
const MAX_CONCURRENT_PREFETCH = 2;
export type CoverLoadPriority = "visible" | "prefetch";
// One small collection (the windowing threshold), independently capped by
// compressed + estimated RGBA bytes. Only unreferenced entries are retained.
export const COVER_RETENTION = { count: 48, bytes: 8 * 1024 * 1024, milliseconds: 10_000 };
const coverUrls = new Map<string, CoverUrlEntry>();
const recentCovers = new Map<string, CoverUrlEntry>();
const coverLoadQueue: CoverLoadTask[] = [];
let activeCoverLoads = 0;
let activePrefetchLoads = 0;
let coverLoadMilliseconds = 250;

/** Three speculative batches cover the next five-column row at two slots. */
export function coverPrefetchLeadTime(): number {
  return Math.min(1500, Math.max(100, coverLoadMilliseconds * 3 + 16));
}

function priorityOf(entry: CoverUrlEntry): CoverLoadPriority {
  return [...entry.priorities.values()].some((consumer) => consumer.priority === "visible")
    ? "visible"
    : "prefetch";
}

function prefetchDistance(entry: CoverUrlEntry): number {
  return Math.min(...[...entry.priorities.values()].map((consumer) => consumer.distance));
}

function retire(key: string, entry: CoverUrlEntry): void {
  if (coverUrls.get(key) === entry) coverUrls.delete(key);
  if (recentCovers.get(key) === entry) recentCovers.delete(key);
  if (entry.revokeTimer !== null) clearTimeout(entry.revokeTimer);
  entry.controller.abort();
  entry.cancelQueued?.();
  entry.image?.removeAttribute("src");
  entry.image = undefined;
  if (entry.url) URL.revokeObjectURL(entry.url);
  entry.url = undefined;
}

function trimRecentCovers(): void {
  let bytes = [...recentCovers.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [key, entry] of recentCovers) {
    if (recentCovers.size <= COVER_RETENTION.count && bytes <= COVER_RETENTION.bytes) break;
    bytes -= entry.bytes;
    retire(key, entry);
  }
}

function drainCoverLoadQueue(): void {
  while (activeCoverLoads < MAX_CONCURRENT_COVER_LOADS && coverLoadQueue.length > 0) {
    let index = coverLoadQueue.findIndex((task) => priorityOf(task.entry) === "visible");
    if (index < 0) {
      if (activePrefetchLoads >= MAX_CONCURRENT_PREFETCH) return;
      index = coverLoadQueue.reduce(
        (best, task, current) =>
          prefetchDistance(task.entry) < prefetchDistance(coverLoadQueue[best]!.entry)
            ? current
            : best,
        0,
      );
    }
    const task = coverLoadQueue.splice(index, 1)[0]!;
    const prefetch = priorityOf(task.entry) === "prefetch";
    activeCoverLoads++;
    if (prefetch) activePrefetchLoads++;
    void task
      .run()
      .then(task.resolve)
      .finally(() => {
        activeCoverLoads--;
        if (prefetch) activePrefetchLoads--;
        drainCoverLoadQueue();
      });
  }
}

export type AcquiredCoverUrl = {
  promise: Promise<string | undefined>;
  release: () => void;
  setPriority: (priority: CoverLoadPriority, distance?: number) => void;
};

export function acquireCoverUrl(
  scope: string,
  key: string,
  load: () => Promise<Blob | undefined>,
  priority: CoverLoadPriority = "visible",
  distance = 0,
): AcquiredCoverUrl {
  const scopedKey = `${scope}\u0000${key}`;
  let entry = coverUrls.get(scopedKey);
  if (!entry) {
    const next: CoverUrlEntry = {
      scope,
      revokeTimer: null,
      controller: new AbortController(),
      bytes: 0,
      priorities: new Map(),
      promise: Promise.resolve(undefined),
    };
    next.promise = new Promise((resolve) => {
      const task: CoverLoadTask = {
        entry: next,
        resolve,
        run: async () => {
          next.cancelQueued = undefined;
          const current = () =>
            !next.controller.signal.aborted && coverUrls.get(scopedKey) === next;
          try {
            if (!current()) return undefined;
            const started = performance.now();
            const blob = await load();
            if (!current()) return undefined;
            if (!blob) throw new Error("Cover unavailable");
            next.url = URL.createObjectURL(blob);
            const image = await decodeCoverImage(next.url, next.controller.signal);
            if (!current()) {
              image.removeAttribute("src");
              return undefined;
            }
            next.image = image;
            coverLoadMilliseconds =
              coverLoadMilliseconds * 0.75 + (performance.now() - started) * 0.25;
            next.bytes = blob.size + next.image.naturalWidth * next.image.naturalHeight * 4;
            return next.url;
          } catch {
            retire(scopedKey, next);
            return undefined;
          }
        },
      };
      next.cancelQueued = () => {
        const index = coverLoadQueue.indexOf(task);
        if (index >= 0) coverLoadQueue.splice(index, 1);
        resolve(undefined);
      };
      coverLoadQueue.push(task);
    });
    entry = next;
    coverUrls.set(scopedKey, entry);
  }

  if (entry.revokeTimer !== null) clearTimeout(entry.revokeTimer);
  entry.revokeTimer = null;
  recentCovers.delete(scopedKey);
  const consumer = Symbol();
  entry.priorities.set(consumer, { priority, distance });
  drainCoverLoadQueue();
  let released = false;

  return {
    promise: entry.promise,
    setPriority: (nextPriority, nextDistance = 0) => {
      if (released || coverUrls.get(scopedKey) !== entry) return;
      entry.priorities.set(consumer, { priority: nextPriority, distance: nextDistance });
      drainCoverLoadQueue();
    },
    release: () => {
      if (released) return;
      released = true;
      entry.priorities.delete(consumer);
      if (entry.priorities.size > 0 || coverUrls.get(scopedKey) !== entry) return;
      if (!entry.image) {
        retire(scopedKey, entry);
        return;
      }
      recentCovers.set(scopedKey, entry);
      entry.revokeTimer = setTimeout(() => retire(scopedKey, entry), COVER_RETENTION.milliseconds);
      trimRecentCovers();
    },
  };
}

export function retireCoverUrlScope(scope: string): void {
  for (const [key, entry] of coverUrls) {
    if (entry.scope === scope) retire(key, entry);
  }
}

export function readyCoverUrl(scope: string, key: string): string | undefined {
  const entry = coverUrls.get(`${scope}\u0000${key}`);
  return entry?.image ? entry.url : undefined;
}

export function coverCacheKey(
  id: string,
  modifiedAt?: string,
  size?: number,
  coverRevision?: string,
): string {
  return `${id}:${coverRevision ?? `${size ?? "unknown"}:${modifiedAt ?? "unknown"}`}`;
}
