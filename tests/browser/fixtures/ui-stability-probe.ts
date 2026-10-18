/** Harness-only, serializable into Chromium or a disposable WebView2 session. */
export function installUIStabilityProbe({ limit = 2400 } = {}) {
  const selectors = {
    frame: ".window-app",
    stage: ".epub-viewer__stage, .reader-status-page, .archive-setup",
    toolbar: ".library-header, .reader-toolbar",
    collection: ".collection-content[data-surface-state]",
    books: "[data-reader-book-id]",
    dialog: "dialog[open]",
    sidebar: ".sidebar",
    titlebar: ".window-titlebar",
    icons: "svg.lucide",
    footer: ".dialog__footer",
    status: "[role=status], [role=alert], .metadata-writeback__changes",
    actions: "dialog[open] .button, .about-update-status .button",
    toast: ".page-shell-notice",
  };
  const frames: ReturnType<typeof sample>[] = [];
  const events: { time: number; kind: string; instance?: number }[] = [];
  const ids = new WeakMap<Element, number>();
  const mounted = new Map<Element, number>();
  const blobs = new Map<string, number>();
  const bookKeys = new Map<string, number>();
  let serial = 0;
  let dropped = 0;
  let stopped = false;
  let raf = 0;
  const createURL = URL.createObjectURL;
  const revokeURL = URL.revokeObjectURL;
  function record(kind: string, instance?: number) {
    if (events.length < limit) events.push({ time: performance.now(), kind, instance });
    else dropped++;
  }
  const wrappedCreate: typeof URL.createObjectURL = (object) => {
    const url = createURL.call(URL, object);
    const id = ++serial;
    blobs.set(url, id);
    record("blob-create", id);
    return url;
  };
  const wrappedRevoke: typeof URL.revokeObjectURL = (url) => {
    record("blob-revoke", blobs.get(url));
    blobs.delete(url);
    revokeURL.call(URL, url);
  };
  URL.createObjectURL = wrappedCreate;
  URL.revokeObjectURL = wrappedRevoke;
  function bounds(node: Element) {
    const rect = node.getBoundingClientRect();
    let id = ids.get(node);
    if (id === undefined) ids.set(node, (id = ++serial));
    const css = getComputedStyle(node);
    const bookId = node.getAttribute("data-reader-book-id");
    if (bookId && !bookKeys.has(bookId) && bookKeys.size < limit) bookKeys.set(bookId, ++serial);
    return {
      instance: id,
      bookKey: bookId ? (bookKeys.get(bookId) ?? null) : null,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      opacity: css.opacity,
      transform: css.transform,
      background: css.backgroundColor,
      animation: css.animationName,
      duration: css.animationDuration,
      transition: css.transitionDuration,
      font: css.fontFamily,
      explicitIconWidth: node.tagName.toLowerCase() === "svg" ? node.getAttribute("width") : null,
      explicitIconHeight: node.tagName.toLowerCase() === "svg" ? node.getAttribute("height") : null,
      busy: node.getAttribute("aria-busy"),
      disabled: node.hasAttribute("disabled"),
      labelLength: node.querySelector(".button__label")?.textContent?.length ?? null,
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
    };
  }
  function sample() {
    const groups = Object.fromEntries(
      Object.entries(selectors).map(([name, selector]) => {
        const nodes = [...document.querySelectorAll(selector)];
        const visible =
          name === "books"
            ? nodes.filter((node) => {
                const rect = node.getBoundingClientRect();
                return rect.bottom > 0 && rect.top < innerHeight;
              })
            : nodes;
        return [name, { mounted: nodes.length, bounds: visible.slice(0, 24).map(bounds) }];
      }),
    );
    const main = document.querySelector(".page-shell, .reader-page, main");
    const focus = document.activeElement;
    const rootCSS = document.documentElement ? getComputedStyle(document.documentElement) : null;
    const collection = document.querySelector<HTMLElement>("[data-window-total]");
    return {
      time: performance.now(),
      state: window.uiStabilityState?.() ?? null,
      groups,
      scrollTop: main?.scrollTop ?? null,
      focus: focus ? { instance: bounds(focus).instance, tag: focus.tagName } : null,
      fonts: {
        status: document.fonts.status,
        interReady: document.fonts.check("400 14px Inter"),
        faces: [...document.fonts].map((face) => ({
          family: face.family,
          status: face.status,
          weight: face.weight,
        })),
      },
      motion: {
        app: document.documentElement?.dataset.motion ?? null,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        running: document.getAnimations().filter((animation) => animation.playState === "running")
          .length,
      },
      palette: {
        theme: document.documentElement?.dataset.appTheme ?? null,
        frame: rootCSS?.getPropertyValue("--surface-app-frame").trim() ?? null,
        main: rootCSS?.getPropertyValue("--surface-main").trim() ?? null,
        body: document.body ? getComputedStyle(document.body).backgroundColor : null,
      },
      window: {
        visibility: document.visibilityState,
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      collection: collection
        ? {
            view: collection.classList.contains("book-list") ? "list" : "grid",
            state: collection.closest<HTMLElement>("[data-surface-state]")?.dataset.surfaceState,
            windowed: collection.dataset.windowed === "true",
            start: Number(collection.dataset.windowStart),
            end: Number(collection.dataset.windowEnd),
            total: Number(collection.dataset.windowTotal),
          }
        : null,
      covers: [...document.querySelectorAll<HTMLImageElement>(".book-cover img")]
        .slice(0, 24)
        .map((img) => ({
          instance: bounds(img).instance,
          complete: img.complete,
          width: img.naturalWidth,
        })),
      activeBlobs: blobs.size,
    };
  }
  function scan() {
    const current = new Set(document.querySelectorAll(Object.values(selectors).join(",")));
    for (const node of current) {
      if (!mounted.has(node)) {
        const id = bounds(node).instance;
        mounted.set(node, id);
        record("dom-mount", id);
      }
    }
    for (const [node, id] of mounted) {
      if (!current.has(node)) {
        mounted.delete(node);
        record("dom-unmount", id);
      }
    }
  }
  const observer = new MutationObserver(scan);
  observer.observe(document, { childList: true, subtree: true });
  const fontEvent = () => record(`fonts-${document.fonts.status}`);
  document.fonts.addEventListener("loading", fontEvent);
  document.fonts.addEventListener("loadingdone", fontEvent);
  document.fonts.addEventListener("loadingerror", fontEvent);
  let longTasksSupported = false;
  const inputs: { time: number; kind: string; trusted: boolean; nextRafMs: number | null }[] = [];
  const inputRafs = new Set<number>();
  const input = (event: Event) => {
    if (inputs.length >= limit) {
      dropped++;
      return;
    }
    const entry = {
      time: performance.now(),
      kind: event.type,
      trusted: event.isTrusted,
      nextRafMs: null as number | null,
    };
    inputs.push(entry);
    const id = requestAnimationFrame(() => {
      inputRafs.delete(id);
      entry.nextRafMs = performance.now() - entry.time;
    });
    inputRafs.add(id);
  };
  for (const kind of ["pointerdown", "keydown", "wheel"])
    document.addEventListener(kind, input, { capture: true, passive: true });
  const longTasks: { time: number; duration: number }[] = [];
  const performanceObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (longTasks.length < limit)
        longTasks.push({ time: entry.startTime, duration: entry.duration });
      else dropped++;
    }
  });
  if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    performanceObserver.observe({ type: "longtask", buffered: true });
    longTasksSupported = true;
  }
  function tick() {
    if (stopped) return;
    if (frames.length < limit) frames.push(sample());
    else dropped++;
    raf = requestAnimationFrame(tick);
  }
  scan();
  raf = requestAnimationFrame(tick);
  const report = () => ({
    timeOrigin: performance.timeOrigin,
    frames,
    events,
    inputs,
    longTasks,
    longTasksSupported,
    dropped,
    paints: performance
      .getEntriesByType("paint")
      .map(({ name, startTime }) => ({ name, time: startTime })),
  });
  const api = {
    sample,
    mark: record,
    stop() {
      if (!stopped) {
        stopped = true;
        cancelAnimationFrame(raf);
        inputRafs.forEach(cancelAnimationFrame);
        inputRafs.clear();
        for (const kind of ["pointerdown", "keydown", "wheel"])
          document.removeEventListener(kind, input, true);
        observer.disconnect();
        performanceObserver.disconnect();
        for (const event of ["loading", "loadingdone", "loadingerror"])
          document.fonts.removeEventListener(event, fontEvent);
        if (URL.createObjectURL === wrappedCreate) URL.createObjectURL = createURL;
        if (URL.revokeObjectURL === wrappedRevoke) URL.revokeObjectURL = revokeURL;
        mounted.clear();
        blobs.clear();
        bookKeys.clear();
      }
      return report();
    },
  };
  window.uiStabilityProbe = api;
  return api;
}

export type UIStabilityReport = ReturnType<Window["uiStabilityProbe"]["stop"]>;
declare global {
  interface Window {
    uiStabilityState?: () => {
      route: string;
      archive: string;
      status: string;
      ready: boolean;
      nativeVisible: boolean | null;
    };
    uiStabilityProbe: ReturnType<typeof installUIStabilityProbe>;
  }
}
