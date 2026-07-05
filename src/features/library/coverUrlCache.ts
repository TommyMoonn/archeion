type CoverUrlEntry = {
  promise: Promise<string | undefined>;
  references: number;
  revokeTimer: ReturnType<typeof setTimeout> | null;
  url?: string;
};

const coverUrls = new Map<string, CoverUrlEntry>();

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
      promise: Promise.resolve()
        .then(load)
        .then((blob) => {
          if (!blob) return undefined;
          nextEntry.url = URL.createObjectURL(blob);
          return nextEntry.url;
        }),
    };
    entry = nextEntry;
    coverUrls.set(key, entry);
  }

  if (entry.revokeTimer !== null) {
    globalThis.clearTimeout(entry.revokeTimer);
    entry.revokeTimer = null;
  }
  entry.references += 1;
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
): string {
  return `${id}:${size ?? "unknown"}:${modifiedAt ?? "unknown"}`;
}
