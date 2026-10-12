import type { Rendition } from "epubjs";
import type View from "epubjs/types/managers/view";
import type { ReaderFixture } from "../../fixtures/reader/readerFixtures";

export type RuntimeAnchor = {
  section: string;
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
  visible: boolean;
};
export type RuntimeSnapshot = {
  time: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  viewportTop: number;
  viewportLeft: number;
  viewportWidth: number;
  viewCount: number;
  views: { id: string; index: number; height: number; mounted: boolean }[];
  sections: { id: string; index: number; top: number; height: number }[];
  anchors: RuntimeAnchor[];
  preceding: string | null;
  following: string | null;
  atBookEnd: boolean;
};
export type RuntimeEvent = {
  type: string;
  time: number;
  section?: string;
  heightDelta?: number;
  cfi?: string;
  deltaY?: number;
  cancelled?: boolean;
  snapshot: RuntimeSnapshot;
};

/** Read-only observation. Never calls check/counter/update or changes scroll anchoring. */
export function observeReaderRuntime(
  stage: HTMLElement,
  fixture: ReaderFixture,
  rendition: Rendition,
) {
  const events: RuntimeEvent[] = [];
  const counts: Record<string, number> = {};
  const renderStarts = new Map<number, number>();
  const renderHookToRenderedMs: number[] = [];
  const cleanup: (() => void)[] = [];
  type ObservedView = View & { iframe?: HTMLIFrameElement; section: { index: number } };
  const viewSubscriptions = new Map<ObservedView, () => void>();
  const documentSubscriptions = new Map<Document, () => void>();
  const observedFrames = new Set<HTMLIFrameElement>();
  let disposed = false;
  const scroller = () => stage.querySelector<HTMLElement>(".epub-container");
  const snapshot = (): RuntimeSnapshot => {
    const outer = scroller();
    const viewport = (outer ?? stage).getBoundingClientRect();
    const sections: RuntimeSnapshot["sections"] = [];
    const anchors: RuntimeAnchor[] = [];
    const views: RuntimeSnapshot["views"] = [];
    // epub.js keeps an empty .epub-view placeholder after destroying its iframe.
    // ref is a read-only vendor DOM marker; do not count it as resident content.
    for (const view of stage.querySelectorAll<HTMLElement>(".epub-view[ref]")) {
      const index = Number(view.getAttribute("ref"));
      const section = fixture.sections[index];
      if (section)
        views.push({
          id: section.id,
          index,
          height: view.getBoundingClientRect().height,
          mounted: Boolean(view.querySelector("iframe")),
        });
    }
    for (const frame of stage.querySelectorAll("iframe")) {
      const doc = frame.contentDocument;
      const index = fixture.sections.findIndex((section) => section.id === doc?.title);
      if (!doc || index < 0) continue;
      const rect = frame.getBoundingClientRect();
      const frameStyle = getComputedStyle(frame);
      const cssWidth = parseFloat(frameStyle.width);
      const cssHeight = parseFloat(frameStyle.height);
      const scaleX = cssWidth ? rect.width / cssWidth : 1;
      const scaleY = cssHeight ? rect.height / cssHeight : 1;
      const shown = frameStyle.visibility === "visible" && frameStyle.display !== "none";
      const id = fixture.sections[index].id;
      sections.push({ id, index, top: rect.top, height: rect.height });
      for (const element of doc.querySelectorAll<HTMLElement>("p[id], img[id]")) {
        const box = element.getBoundingClientRect();
        const elementStyle = doc.defaultView?.getComputedStyle(element);
        const top = rect.top + box.top * scaleY;
        const left = rect.left + box.left * scaleX;
        const width = box.width * scaleX;
        const height = box.height * scaleY;
        anchors.push({
          section: id,
          id: element.id,
          top,
          left,
          width,
          height,
          visible:
            shown &&
            elementStyle?.visibility === "visible" &&
            box.height > 0 &&
            top < Math.min(viewport.bottom, rect.bottom) &&
            top + height > Math.max(viewport.top, rect.top) &&
            left < Math.min(viewport.right, rect.right) &&
            left + width > Math.max(viewport.left, rect.left),
        });
      }
    }
    const visible = sections.filter(
      (section) => section.top < viewport.bottom && section.top + section.height > viewport.top,
    );
    const first = visible[0]?.index;
    const last = visible.at(-1)?.index;
    return {
      time: performance.now(),
      scrollTop: outer?.scrollTop ?? 0,
      scrollHeight: outer?.scrollHeight ?? 0,
      clientHeight: outer?.clientHeight ?? 0,
      viewportTop: viewport.top,
      viewportLeft: viewport.left,
      viewportWidth: outer?.clientWidth ?? viewport.width,
      viewCount: sections.length,
      views,
      sections,
      anchors,
      preceding: first === undefined ? null : (fixture.sections[first - 1]?.id ?? null),
      following: last === undefined ? null : (fixture.sections[last + 1]?.id ?? null),
      atBookEnd:
        last === fixture.sections.length - 1 &&
        Boolean(outer && outer.scrollHeight - outer.clientHeight - outer.scrollTop <= 2),
    };
  };
  const record = (
    type: string,
    details: Omit<Partial<RuntimeEvent>, "type" | "time" | "snapshot"> = {},
  ) => {
    if (!disposed) {
      counts[type] = (counts[type] ?? 0) + 1;
      events.push({ type, time: performance.now(), ...details, snapshot: snapshot() });
      // Long local experiments stay bounded. No DOM nodes or publication text retained.
      if (events.length > 300) events.shift();
    }
  };
  const render = (view: ObservedView) => {
    renderStarts.set(view.section.index, performance.now());
    if (viewSubscriptions.has(view)) return;
    const resized = (bounds: { heightDelta: number }) =>
      record("view-resized", {
        heightDelta: bounds.heightDelta,
        section: fixture.sections[view.section.index]?.id,
      });
    view.on("resized", resized);
    viewSubscriptions.set(view, () => view.off("resized", resized));
  };
  const rendered = (section: { index: number }) => {
    const started = renderStarts.get(section.index);
    if (started !== undefined && renderHookToRenderedMs.length < 1_000)
      renderHookToRenderedMs.push(performance.now() - started);
    renderStarts.delete(section.index);
    record("rendered", { section: fixture.sections[section.index]?.id });
  };
  const relocated = (location: { start: { cfi: string } }) =>
    record("relocated", { cfi: location.start.cfi });
  const resized = () => record("rendition-resized");
  rendition.hooks.render.register(render);
  rendition.on("rendered", rendered);
  rendition.on("relocated", relocated);
  rendition.on("resized", resized);
  const bind = () => {
    for (const [view, release] of viewSubscriptions) {
      if (!view.iframe?.isConnected) {
        release();
        viewSubscriptions.delete(view);
      }
    }
    for (const [document, release] of documentSubscriptions) {
      if (!document.defaultView?.frameElement?.isConnected) {
        release();
        documentSubscriptions.delete(document);
      }
    }
    for (const frame of observedFrames) {
      if (!frame.isConnected) {
        geometry.unobserve(frame);
        observedFrames.delete(frame);
      }
    }
    const outer = scroller();
    if (outer && outer !== boundScroller) {
      boundScroller = outer;
      const scroll = () => record("scroll");
      outer.addEventListener("scroll", scroll, { passive: true });
      cleanup.push(() => outer.removeEventListener("scroll", scroll));
    }
    for (const frame of stage.querySelectorAll("iframe")) {
      const doc = frame.contentDocument;
      if (!doc?.body || documentSubscriptions.has(doc)) continue;
      const wheel = (event: WheelEvent) =>
        queueMicrotask(() =>
          record("iframe-wheel", { deltaY: event.deltaY, cancelled: event.defaultPrevented }),
        );
      const target = doc.defaultView ?? doc;
      target.addEventListener("wheel", wheel as EventListener, { passive: true, capture: true });
      documentSubscriptions.set(doc, () =>
        target.removeEventListener("wheel", wheel as EventListener, true),
      );
    }
  };
  let boundScroller: HTMLElement | null = null;
  let pendingGeometry: number | null = null;
  const scheduleGeometry = () => {
    if (pendingGeometry !== null || disposed) return;
    pendingGeometry = requestAnimationFrame(() => {
      pendingGeometry = null;
      bind();
      record("mounted-geometry");
    });
  };
  const mutation = new MutationObserver(scheduleGeometry);
  mutation.observe(stage, { childList: true, subtree: true });
  // Initial RESIZED occurs before the public render hook. This observer is an
  // integration-level geometry surrogate, not a measurement of counter() calls.
  const geometry = new ResizeObserver(scheduleGeometry);
  geometry.observe(stage);
  const onRendered = () => {
    bind();
    for (const frame of stage.querySelectorAll("iframe")) {
      geometry.observe(frame);
      observedFrames.add(frame);
    }
  };
  rendition.on("rendered", onRendered);
  return {
    snapshot,
    events: () => [...events],
    metrics: () => ({ counts: { ...counts }, renderHookToRenderedMs: [...renderHookToRenderedMs] }),
    clear: () => {
      events.length = 0;
    },
    dispose() {
      disposed = true;
      if (pendingGeometry !== null) cancelAnimationFrame(pendingGeometry);
      mutation.disconnect();
      geometry.disconnect();
      for (const release of cleanup) release();
      for (const release of viewSubscriptions.values()) release();
      for (const release of documentSubscriptions.values()) release();
      viewSubscriptions.clear();
      documentSubscriptions.clear();
      observedFrames.clear();
      renderStarts.clear();
      rendition.hooks.render.deregister(render);
      rendition.off("rendered", rendered);
      rendition.off("relocated", relocated);
      rendition.off("resized", resized);
      rendition.off("rendered", onRendered);
    },
  };
}
