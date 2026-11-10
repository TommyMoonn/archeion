import { useLayoutEffect, useState, type RefObject } from "react";

import {
  APP_SELECT_MIN_WIDTH,
  calculateAppSelectPlacement,
  convertAppSelectPlacementToFixedCoordinateSpace,
  getAppSelectFixedCoordinateSpace,
  type AppSelectPlacement,
} from "./appSelectPlacement";

type UseAppSelectPlacementOptions = {
  activeOptionId?: string;
  contentRevision: string;
  menuRef: RefObject<HTMLDivElement | null>;
  maxMenuHeight?: number;
  minMenuWidth?: number;
  open: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
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
  // Rects are viewport pixels; scrollTop and border widths are unscaled CSS pixels.
  const scaleY =
    menu.offsetHeight > 0 && menuRect.height > 0 ? menuRect.height / menu.offsetHeight : 1;
  const visibleTop = menuRect.top + menu.clientTop * scaleY;
  const visibleBottom = menuRect.bottom - menu.clientTop * scaleY;

  if (optionRect.top < visibleTop) {
    menu.scrollTop += (optionRect.top - visibleTop) / scaleY;
  } else if (optionRect.bottom > visibleBottom) {
    menu.scrollTop += (optionRect.bottom - visibleBottom) / scaleY;
  }
}

export function useAppSelectPlacement({
  activeOptionId,
  contentRevision,
  menuRef,
  maxMenuHeight,
  minMenuWidth,
  open,
  scrollRef,
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
      const coordinateSpace = getAppSelectFixedCoordinateSpace(menu);

      // Re-measure at intrinsic width instead of inheriting a previous placement's
      // inline width. This lets long labels widen the menu before it is viewport-clamped.
      const previousWidth = menu.style.width;
      let intendedMenuHeight: number;
      let intendedMenuWidth: number;
      try {
        menu.style.width = "max-content";
        const contentRect = menu.getBoundingClientRect();
        const borderHeight = Math.max(
          0,
          contentRect.height / coordinateSpace.scaleY - menu.clientHeight,
        );
        intendedMenuHeight =
          Math.min(maxMenuHeight ?? Infinity, menu.scrollHeight + borderHeight) *
          coordinateSpace.scaleY;
        intendedMenuWidth =
          Math.max(
            APP_SELECT_MIN_WIDTH,
            minMenuWidth ?? 0,
            triggerRect.width / coordinateSpace.scaleX,
            contentRect.width / coordinateSpace.scaleX,
          ) * coordinateSpace.scaleX;
      } finally {
        menu.style.width = previousWidth;
      }
      const viewportPlacement = calculateAppSelectPlacement({
        intendedMenuHeight,
        intendedMenuWidth,
        trigger: triggerRect,
        viewport: currentViewport(),
      });
      const next = convertAppSelectPlacementToFixedCoordinateSpace(
        viewportPlacement,
        coordinateSpace,
      );
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
    const coordinateSpace = getAppSelectFixedCoordinateSpace(menu);
    if (coordinateSpace.element) resizeObserver?.observe(coordinateSpace.element);

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
  }, [contentRevision, maxMenuHeight, menuRef, minMenuWidth, open, triggerRef]);

  useLayoutEffect(() => {
    if (!open || !placement || !activeOptionId) return;
    const menu = (scrollRef ?? menuRef).current;
    const option = menu?.ownerDocument.getElementById(activeOptionId);
    if (!menu || !option || !menu.contains(option)) return;
    scrollAppSelectOptionIntoView(menu, option);
  }, [activeOptionId, contentRevision, menuRef, open, placement, scrollRef]);

  return placement;
}
