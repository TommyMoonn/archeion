export type CoverReadinessOptions = { fileDelay: number; decodeDelay: number };

/** Test-only instrumentation, installed before the fixture mounts production components. */
export function installCoverReadinessProbe(options: CoverReadinessOptions) {
  type Entry = {
    id: string;
    phase: string;
    entered: number;
    exited: number | null;
    ready: number | null;
    readyAtEntry: boolean;
    mounted: number;
    horizon: number | null;
    eligible: number | null;
    margin: string | null;
  };
  const entries: Entry[] = [];
  const files: Array<{ id: string; start: number; end: number | null }> = [];
  const decodes: Array<{ url: string; start: number; end: number | null; failed: boolean }> = [];
  const frames: Array<{
    phase: string;
    time: number;
    scroll: number;
    velocity: number;
    mounted: number;
    visibleLoading: number;
    height: number;
  }> = [];
  const urls = new Set<string>();
  const decodeReady = new Map<string, number>();
  const mounted = new Map<Element, { time: number; horizon: number | null }>();
  const visible = new Map<Element, Entry>();
  const eligibility = new WeakMap<Element, { time: number; margin: string }>();
  const originalObserver = window.IntersectionObserver;
  window.IntersectionObserver = class extends originalObserver {
    constructor(
      callback: IntersectionObserverCallback,
      observerOptions?: IntersectionObserverInit,
    ) {
      super((records, observer) => {
        if (observerOptions?.rootMargin)
          for (const record of records) {
            if (record.isIntersecting && !eligibility.has(record.target))
              eligibility.set(record.target, {
                time: performance.now(),
                margin: observerOptions.rootMargin,
              });
            const entry = visible.get(record.target);
            const admitted = eligibility.get(record.target);
            if (entry && admitted && entry.eligible === null) {
              entry.eligible = admitted.time;
              entry.margin = admitted.margin;
            }
          }
        callback(records, observer);
      }, observerOptions);
    }
  };
  let phase = "initial-cold";
  let activeFiles = 0,
    activeDecodes = 0,
    peakFiles = 0,
    peakDecodes = 0,
    peakUrls = 0;
  let lastScroll = 0,
    lastTime = 0,
    raf = 0;
  const create = URL.createObjectURL.bind(URL),
    revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    urls.add(url);
    peakUrls = Math.max(peakUrls, urls.size);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    urls.delete(url);
    revoke(url);
  };
  const decode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = async function () {
    if (!this.src.startsWith("blob:")) return decode.call(this);
    const record = {
      url: this.src,
      start: performance.now(),
      end: null as number | null,
      failed: false,
    };
    decodes.push(record);
    activeDecodes++;
    peakDecodes = Math.max(peakDecodes, activeDecodes);
    let observer: MutationObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (options.decodeDelay)
        await new Promise<void>((resolve, reject) => {
          timer = setTimeout(resolve, options.decodeDelay);
          observer = new MutationObserver(() => {
            if (!this.getAttribute("src")) reject(new Error("Retired decode"));
          });
          observer.observe(this, { attributes: true, attributeFilter: ["src"] });
        });
      await decode.call(this);
      record.end = performance.now();
      decodeReady.set(record.url, record.end);
    } catch (error) {
      record.failed = true;
      throw error;
    } finally {
      record.end ??= performance.now();
      clearTimeout(timer);
      observer?.disconnect();
      activeDecodes--;
    }
  };
  window.installCoverReadinessProbe = () => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command, args) => {
      if (command !== "load_epub_cover") return invoke(command, args);
      const record = {
        id: String(args.bookId),
        start: performance.now(),
        end: null as number | null,
      };
      files.push(record);
      activeFiles++;
      peakFiles = Math.max(peakFiles, activeFiles);
      try {
        if (options.fileDelay)
          await new Promise((resolve) => setTimeout(resolve, options.fileDelay));
        return await invoke(command, args);
      } finally {
        record.end = performance.now();
        activeFiles--;
      }
    };
  };
  const sample = () => {
    const time = performance.now();
    const host = document.querySelector<HTMLElement>(".page-shell");
    if (host) {
      const bounds = host.getBoundingClientRect();
      const current = new Set<Element>();
      const cards = [...document.querySelectorAll<HTMLElement>("[data-reader-book-id]")];
      let visibleLoading = 0;
      for (const card of cards) {
        const cover = card.querySelector<HTMLElement>(".book-cover");
        if (!cover) continue;
        const rect = cover.getBoundingClientRect();
        let lifetime = mounted.get(cover);
        if (!lifetime) {
          lifetime = { time, horizon: null };
          mounted.set(cover, lifetime);
        }
        if (
          lifetime.horizon === null &&
          rect.bottom > bounds.top - bounds.height * 0.75 &&
          rect.top < bounds.bottom + bounds.height * 0.75
        )
          lifetime.horizon = time;
        const img = cover.querySelector<HTMLImageElement>("img");
        const ready =
          cover.dataset.coverState === "available"
            ? ((img && decodeReady.get(img.src)) ?? time)
            : null;
        for (const entry of entries)
          if (entry.id === card.dataset.readerBookId && entry.ready === null && ready !== null)
            entry.ready = ready;
        if (rect.bottom <= bounds.top || rect.top >= Math.min(bounds.bottom, innerHeight)) continue;
        current.add(cover);
        if (ready === null) visibleLoading++;
        if (!visible.has(cover)) {
          const entry: Entry = {
            id: card.dataset.readerBookId!,
            phase,
            entered: time,
            exited: null,
            ready,
            readyAtEntry: ready !== null,
            mounted: lifetime.time,
            horizon: lifetime.horizon,
            eligible: eligibility.get(cover)?.time ?? null,
            margin: eligibility.get(cover)?.margin ?? null,
          };
          entries.push(entry);
          visible.set(cover, entry);
        }
      }
      for (const [cover, entry] of visible)
        if (!current.has(cover)) {
          entry.exited = time;
          visible.delete(cover);
        }
      for (const cover of mounted.keys()) if (!cover.isConnected) mounted.delete(cover);
      if (frames.length < 6000)
        frames.push({
          phase,
          time,
          scroll: host.scrollTop,
          velocity: lastTime ? ((host.scrollTop - lastScroll) * 1000) / (time - lastTime) : 0,
          mounted: cards.length,
          visibleLoading,
          height: host.clientHeight,
        });
      lastScroll = host.scrollTop;
      lastTime = time;
    }
    raf = requestAnimationFrame(sample);
  };
  raf = requestAnimationFrame(sample);
  window.coverReadinessProbe = {
    phase: (value: string) => {
      phase = value;
    },
    snapshot: () => ({
      entries,
      files,
      decodes,
      frames,
      activeFiles,
      activeDecodes,
      peakFiles,
      peakDecodes,
      peakUrls,
      liveUrls: urls.size,
      time: performance.now(),
    }),
    stop: () => {
      cancelAnimationFrame(raf);
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      HTMLImageElement.prototype.decode = decode;
      window.IntersectionObserver = originalObserver;
    },
  };
}

declare global {
  interface Window {
    installCoverReadinessProbe?: () => void;
    coverReadinessProbe: {
      phase: (value: string) => void;
      snapshot: () => {
        entries: Array<{
          id: string;
          phase: string;
          entered: number;
          exited: number | null;
          ready: number | null;
          readyAtEntry: boolean;
          mounted: number;
          horizon: number | null;
          eligible: number | null;
          margin: string | null;
        }>;
        files: Array<{ id: string; start: number; end: number | null }>;
        decodes: Array<{ url: string; start: number; end: number | null; failed: boolean }>;
        frames: Array<{
          phase: string;
          time: number;
          scroll: number;
          velocity: number;
          mounted: number;
          visibleLoading: number;
          height: number;
        }>;
        activeFiles: number;
        activeDecodes: number;
        peakFiles: number;
        peakDecodes: number;
        peakUrls: number;
        liveUrls: number;
        time: number;
      };
      stop: () => void;
    };
  }
}
