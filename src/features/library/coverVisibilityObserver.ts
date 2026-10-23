import { coverPrefetchLeadTime, type CoverLoadPriority } from "./coverUrlCache";

export type CoverVisibility = CoverLoadPriority | null;
type Observation = {
  near: boolean;
  visible: boolean;
  last: CoverVisibility | undefined;
  distance: number;
  notify: (priority: CoverVisibility, distance: number) => void;
};
type CoverViewport = {
  root: HTMLElement | null;
  near: IntersectionObserver | null;
  visible: IntersectionObserver | null;
  observations: Map<Element, Observation>;
  velocity: number;
  position: number;
  time: number;
  margin: string;
  raf: number;
  refresh: () => void;
};
const viewports = new Map<HTMLElement | null, CoverViewport>();

function viewportHeight(viewport: CoverViewport): number {
  return viewport.root?.clientHeight || window.innerHeight;
}

function notify(viewport: CoverViewport, element: Element, observation: Observation): void {
  const priority = observation.visible ? "visible" : observation.near ? "prefetch" : null;
  const rect = element.getBoundingClientRect();
  const bounds = viewport.root?.getBoundingClientRect();
  const top = bounds?.top ?? 0,
    bottom = bounds?.bottom ?? window.innerHeight;
  const ahead = viewport.velocity < 0 ? top - rect.bottom : rect.top - bottom;
  const behind = ahead < 0 && (rect.bottom <= top || rect.top >= bottom);
  const distance =
    priority === "visible"
      ? 0
      : Math.max(0, Math.abs(ahead)) + (behind ? viewportHeight(viewport) * 2 : 0);
  if (priority !== observation.last || distance !== observation.distance) {
    observation.last = priority;
    observation.distance = distance;
    observation.notify(priority, distance);
  }
}

function update(
  viewport: CoverViewport,
  entries: IntersectionObserverEntry[],
  kind: "near" | "visible",
): void {
  for (const entry of entries) {
    const observation = viewport.observations.get(entry.target);
    if (!observation) continue;
    observation[kind] = entry.isIntersecting;
    notify(viewport, entry.target, observation);
  }
}

function configureNear(viewport: CoverViewport): void {
  const height = viewportHeight(viewport);
  // Match the existing retained window's 0.75-viewport overscan. Faster travel
  // can use more lead, but only already-mounted covers are ever observed.
  const trailing = Math.ceil(height * 0.75);
  const ahead =
    Math.ceil(
      Math.min(
        height * 1.5,
        Math.max(trailing, (Math.abs(viewport.velocity) * coverPrefetchLeadTime()) / 1000),
      ) / 64,
    ) * 64;
  const margin =
    viewport.velocity < 0 ? `${ahead}px 0px ${trailing}px 0px` : `${trailing}px 0px ${ahead}px 0px`;
  if (margin === viewport.margin) return;
  viewport.margin = margin;
  viewport.near?.disconnect();
  const observer = new IntersectionObserver(
    (entries) => {
      if (viewport.near === observer) update(viewport, entries, "near");
    },
    {
      root: viewport.root,
      rootMargin: margin,
    },
  );
  viewport.near = observer;
  for (const element of viewport.observations.keys()) viewport.near.observe(element);
}

function createViewport(root: HTMLElement | null): CoverViewport {
  const viewport: CoverViewport = {
    root,
    observations: new Map(),
    velocity: 0,
    position: root?.scrollTop ?? window.scrollY,
    time: performance.now(),
    margin: "",
    raf: 0,
    near: null,
    visible: null,
    refresh: () => {
      if (viewport.raf) return;
      viewport.raf = requestAnimationFrame(() => {
        viewport.raf = 0;
        const time = performance.now(),
          position = root?.scrollTop ?? window.scrollY;
        const delta = position - viewport.position;
        if (delta) {
          const speed = (delta * 1000) / Math.max(16, time - viewport.time);
          viewport.velocity =
            Math.sign(speed) !== Math.sign(viewport.velocity)
              ? speed
              : viewport.velocity * 0.5 + speed * 0.5;
        }
        viewport.time = time;
        viewport.position = position;
        configureNear(viewport);
        for (const [element, observation] of viewport.observations)
          notify(viewport, element, observation);
      });
    },
  };
  configureNear(viewport);
  viewport.visible = new IntersectionObserver((entries) => update(viewport, entries, "visible"), {
    root,
  });
  (root ?? window).addEventListener("scroll", viewport.refresh, { passive: true });
  window.addEventListener("resize", viewport.refresh);
  return viewport;
}

function scrollRoot(element: Element): HTMLElement | null {
  const page = element.closest<HTMLElement>(".page-shell");
  if (page) return page;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (["auto", "scroll"].includes(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

export function observeCoverVisibility(
  element: Element,
  onVisibility: (priority: CoverVisibility, distance: number) => void,
): () => void {
  const root = scrollRoot(element);
  const viewport = viewports.get(root) ?? createViewport(root);
  viewports.set(root, viewport);
  viewport.observations.set(element, {
    near: false,
    visible: false,
    last: undefined,
    distance: 0,
    notify: onVisibility,
  });
  viewport.near?.observe(element);
  viewport.visible?.observe(element);
  return () => {
    viewport.observations.delete(element);
    viewport.near?.unobserve(element);
    viewport.visible?.unobserve(element);
    if (!viewport.observations.size) {
      viewport.near?.disconnect();
      viewport.visible?.disconnect();
      (root ?? window).removeEventListener("scroll", viewport.refresh);
      window.removeEventListener("resize", viewport.refresh);
      cancelAnimationFrame(viewport.raf);
      viewports.delete(root);
    }
  };
}
