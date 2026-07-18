import { useLayoutEffect, useState, type RefObject } from "react";

import {
  APP_SELECT_MIN_WIDTH,
  calculateAppSelectPlacement,
  type AppSelectPlacement,
} from "./appSelectPlacement";

type UseAppSelectPlacementOptions = {
  activeOptionId?: string;
  contentRevision: string;
  menuRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

function samePlacement(current: AppSelectPlacement | null, next: AppSelectPlacement): boolean {
  return (
    current?.left === next.left &&
    current.maxHeight === next.maxHeight &&
    current.placement === next.placement &&
    current.top === next.top &&
    current.width === next.width
  );
}

function currentViewport() {
  const viewport = window.visualViewport;
  return {
    height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
  };
}

export function scrollAppSelectOptionIntoView(menu: HTMLElement, option: HTMLElement): void {
  const menuRect = menu.getBoundingClientRect();
  const optionRect = option.getBoundingClientRect();
  const visibleTop = menuRect.top + menu.clientTop;
  const visibleBottom = menuRect.bottom - menu.clientTop;

  if (optionRect.top < visibleTop) {
    menu.scrollTop += optionRect.top - visibleTop;
  } else if (optionRect.bottom > visibleBottom) {
    menu.scrollTop += optionRect.bottom - visibleBottom;
  }
}

export function useAppSelectPlacement({
  activeOptionId,
  contentRevision,
  menuRef,
  open,
  triggerRef,
}: UseAppSelectPlacementOptions): AppSelectPlacement | null {
  const [placement, setPlacement] = useState<AppSelectPlacement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    let frameId: number | null = null;

    const measure = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const borderHeight = Math.max(0, menuRect.height - menu.clientHeight);
      const next = calculateAppSelectPlacement({
        intendedMenuHeight: menu.scrollHeight + borderHeight,
        intendedMenuWidth: Math.max(APP_SELECT_MIN_WIDTH, triggerRect.width),
        trigger: triggerRect,
        viewport: currentViewport(),
      });
      setPlacement((current) => (samePlacement(current, next) ? current : next));
    };

    const scheduleMeasurement = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };

    measure();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => scheduleMeasurement());
    resizeObserver?.observe(trigger);
    resizeObserver?.observe(menu);

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", scheduleMeasurement);
    window.addEventListener("scroll", scheduleMeasurement, true);
    visualViewport?.addEventListener("resize", scheduleMeasurement);
    visualViewport?.addEventListener("scroll", scheduleMeasurement);

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasurement);
      window.removeEventListener("scroll", scheduleMeasurement, true);
      visualViewport?.removeEventListener("resize", scheduleMeasurement);
      visualViewport?.removeEventListener("scroll", scheduleMeasurement);
    };
  }, [contentRevision, menuRef, open, triggerRef]);

  useLayoutEffect(() => {
    if (!open || !placement || !activeOptionId) return;
    const menu = menuRef.current;
    const option = menu?.ownerDocument.getElementById(activeOptionId);
    if (!menu || !option || !menu.contains(option)) return;
    scrollAppSelectOptionIntoView(menu, option);
  }, [activeOptionId, menuRef, open, placement]);

  return placement;
}
