type CoverUrlEntry = {
  promise: Promise<string | undefined>;
  references: number;
  revokeTimer: ReturnType<typeof setTimeout> | null;
  url?: string;
};

type CoverLoadTask = {
  load: () => Promise<Blob | undefined>;
  reject: (reason?: unknown) => void;
  resolve: (value: Blob | undefined) => void;
  shouldStart: () => boolean;
};

const MAX_CONCURRENT_COVER_LOADS = 4;
const coverUrls = new Map<string, CoverUrlEntry>();
const coverLoadQueue: CoverLoadTask[] = [];
let activeCoverLoads = 0;

function drainCoverLoadQueue(): void {
  while (activeCoverLoads < MAX_CONCURRENT_COVER_LOADS && coverLoadQueue.length > 0) {
    const task = coverLoadQueue.shift();
    if (!task) return;

    if (!task.shouldStart()) {
      task.resolve(undefined);
      continue;
    }

    activeCoverLoads += 1;
    Promise.resolve()
      .then(task.load)
      .then(task.resolve, task.reject)
      .finally(() => {
        activeCoverLoads = Math.max(0, activeCoverLoads - 1);
        drainCoverLoadQueue();
      });
  }
}

function enqueueCoverLoad(
  load: () => Promise<Blob | undefined>,
  shouldStart: () => boolean,
): Promise<Blob | undefined> {
  return new Promise((resolve, reject) => {
    coverLoadQueue.push({ load, reject, resolve, shouldStart });
  });
}

export type AcquiredCoverUrl = {
  promise: Promise<string | undefined>;
  release: () => void;
};

export function acquireCoverUrl(
  key: string,
  load: () => Promise<Blob | undefined>,
): AcquiredCoverUrl {
  let entry = coverUrls.get(key);

  if (!entry) {
    const nextEntry: CoverUrlEntry = {
      references: 0,
      revokeTimer: null,
      promise: Promise.resolve(undefined),
    };
    nextEntry.promise = enqueueCoverLoad(
      load,
      () => nextEntry.references > 0 && coverUrls.get(key) === nextEntry,
    ).then((blob) => {
      if (!blob || nextEntry.references === 0 || coverUrls.get(key) !== nextEntry) {
        if (nextEntry.references === 0 && coverUrls.get(key) === nextEntry) {
          coverUrls.delete(key);
        }

        return undefined;
      }

      nextEntry.url = URL.createObjectURL(blob);
      return nextEntry.url;
    });
    entry = nextEntry;
    coverUrls.set(key, entry);
  }

  if (entry.revokeTimer !== null) {
    globalThis.clearTimeout(entry.revokeTimer);
    entry.revokeTimer = null;
  }
  entry.references += 1;
  drainCoverLoadQueue();
  let released = false;

  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.references = Math.max(0, entry.references - 1);
      if (entry.references > 0) return;

      entry.revokeTimer = globalThis.setTimeout(() => {
        if (entry.references > 0 || coverUrls.get(key) !== entry) return;
        coverUrls.delete(key);
        void entry.promise
          .then((url) => {
            if (url) URL.revokeObjectURL(url);
          })
          .catch(() => undefined);
      }, 1_000);
    },
  };
}

export function coverCacheKey(
  id: string,
  modifiedAt?: string,
  size?: number,
  coverRevision?: string,
): string {
  return `${id}:${coverRevision ?? `${size ?? "unknown"}:${modifiedAt ?? "unknown"}`}`;
}
