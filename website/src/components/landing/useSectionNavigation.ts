import { useEffect, useState, type MouseEvent } from "react";
import { landingSections, type LandingSectionId } from "./content";

export function focusLandingAnchor(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return false;
  const id = event.currentTarget.hash.slice(1);
  const destination = document.getElementById(id);
  if (!destination) return false;
  // Leave URL history and scrolling to the native anchor, but move keyboard focus.
  destination.focus({ preventScroll: true });
  return true;
}

export function useSectionNavigation() {
  const [active, setActive] = useState<LandingSectionId | null>(null);
  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const update = () => {
      frame = 0;
      const marker = 100;
      const current = landingSections.find(({ id }) => {
        const bounds = document.getElementById(id)?.getBoundingClientRect();
        return bounds && bounds.top <= marker && bounds.bottom > marker;
      });
      setActive(current?.id ?? null);
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    void document.fonts.ready.then(schedule);
    update();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.fonts.removeEventListener("loadingdone", schedule);
    };
  }, []);
  return active;
}
