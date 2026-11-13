import { useLayoutEffect, useState, type RefObject } from "react";

import {
  APP_SELECT_MIN_WIDTH,
  APP_SELECT_VIEWPORT_MARGIN,
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
  widthStrategy?: "content" | "trigger";
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
  widthStrategy = "content",
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

      // Content-sized menus measure intrinsic width before viewport clamping.
      // Trigger-sized menus retain the trigger width as their catalog changes.
      const previousWidth = menu.style.width;
      let intendedMenuHeight: number;
      let intendedMenuWidth: number;
      const viewport = currentViewport();
      try {
        const minWidth = Math.max(APP_SELECT_MIN_WIDTH, minMenuWidth ?? 0) * coordinateSpace.scaleX;
        intendedMenuWidth = Math.max(triggerRect.width, minWidth);

        if (widthStrategy === "content") {
          menu.style.width = "max-content";
          const contentRect = menu.getBoundingClientRect();
          intendedMenuWidth = Math.max(intendedMenuWidth, contentRect.width);
        }

        // Measure height at the width that will actually be rendered. This matters
        // for trigger-sized menus whose option labels wrap after catalog updates.
        const availableWidth = Math.max(0, viewport.width - APP_SELECT_VIEWPORT_MARGIN * 2);
        intendedMenuWidth = Math.min(intendedMenuWidth, availableWidth);
        menu.style.width = `${intendedMenuWidth / coordinateSpace.scaleX}px`;

        const measuredRect = menu.getBoundingClientRect();
        const borderHeight = Math.max(
          0,
          measuredRect.height / coordinateSpace.scaleY - menu.clientHeight,
        );
        intendedMenuHeight =
          Math.min(maxMenuHeight ?? Infinity, menu.scrollHeight + borderHeight) *
          coordinateSpace.scaleY;
      } finally {
        menu.style.width = previousWidth;
      }
      const viewportPlacement = calculateAppSelectPlacement({
        intendedMenuHeight,
        intendedMenuWidth,
        trigger: triggerRect,
        viewport,
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
  }, [contentRevision, maxMenuHeight, menuRef, minMenuWidth, open, triggerRef, widthStrategy]);

  useLayoutEffect(() => {
    if (!open || !placement || !activeOptionId) return;
    const menu = (scrollRef ?? menuRef).current;
    const option = menu?.ownerDocument.getElementById(activeOptionId);
    if (!menu || !option || !menu.contains(option)) return;
    scrollAppSelectOptionIntoView(menu, option);
  }, [activeOptionId, contentRevision, menuRef, open, placement, scrollRef]);

  return placement;
}
