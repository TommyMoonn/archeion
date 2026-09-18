export const APP_SELECT_VIEWPORT_MARGIN = 8;
export const APP_SELECT_TRIGGER_GAP = 6;
export const APP_SELECT_MIN_WIDTH = 188;

export type AppSelectPlacement = {
  left: number;
  maxHeight: number;
  placement: "above" | "below";
  top: number;
  width: number;
};

type AppSelectFixedCoordinateSpace = {
  element: HTMLElement | null;
  left: number;
  scaleX: number;
  scaleY: number;
  top: number;
};

export type AppSelectPlacementInput = {
  intendedMenuHeight: number;
  intendedMenuWidth: number;
  trigger: {
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
  };
  viewport: {
    height: number;
    left: number;
    top: number;
    width: number;
  };
  gap?: number;
  margin?: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

export function calculateAppSelectPlacement({
  gap = APP_SELECT_TRIGGER_GAP,
  intendedMenuHeight,
  intendedMenuWidth,
  margin = APP_SELECT_VIEWPORT_MARGIN,
  trigger,
  viewport,
}: AppSelectPlacementInput): AppSelectPlacement {
  const viewportLeft = viewport.left + margin;
  const viewportTop = viewport.top + margin;
  const viewportRight = viewport.left + viewport.width - margin;
  const viewportBottom = viewport.top + viewport.height - margin;
  const availableWidth = Math.max(0, viewportRight - viewportLeft);
  const width = Math.min(Math.max(trigger.width, intendedMenuWidth), availableWidth);
  const spaceBelow = Math.max(0, viewportBottom - trigger.bottom - gap);
  const spaceAbove = Math.max(0, trigger.top - viewportTop - gap);
  const placement = intendedMenuHeight > spaceBelow && spaceAbove > spaceBelow ? "above" : "below";
  const maxHeight = placement === "below" ? spaceBelow : spaceAbove;
  const renderedHeight = Math.min(intendedMenuHeight, maxHeight);
  const top = placement === "below" ? trigger.bottom + gap : trigger.top - gap - renderedHeight;
  const left = clamp(trigger.left, viewportLeft, viewportRight - width);

  return { left, maxHeight, placement, top, width };
}

function nonDefaultContainingBlockValue(value: string | undefined): boolean {
  return Boolean(value && value !== "none" && value !== "normal");
}

function isActiveModalDialog(element: HTMLElement): boolean {
  if (element.tagName !== "DIALOG") return false;

  try {
    return element.matches(":modal");
  } catch {
    return false;
  }
}

function establishesFixedContainingBlock(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (
    nonDefaultContainingBlockValue(style.transform) ||
    nonDefaultContainingBlockValue(style.translate) ||
    nonDefaultContainingBlockValue(style.rotate) ||
    nonDefaultContainingBlockValue(style.scale) ||
    nonDefaultContainingBlockValue(style.perspective) ||
    nonDefaultContainingBlockValue(style.filter) ||
    nonDefaultContainingBlockValue(style.backdropFilter)
  ) {
    return true;
  }

  const containment = style.contain.split(/\s+/);
  if (containment.some((value) => ["layout", "paint", "strict", "content"].includes(value))) {
    return true;
  }
  if (style.contentVisibility === "auto") {
    return true;
  }

  const willChange = style.willChange.split(",").map((value) => value.trim());
  return willChange.some((value) =>
    [
      "transform",
      "translate",
      "rotate",
      "scale",
      "perspective",
      "filter",
      "backdrop-filter",
    ].includes(value),
  );
}

export function getAppSelectFixedCoordinateSpace(menu: HTMLElement): AppSelectFixedCoordinateSpace {
  let containingBlock = menu.parentElement;
  while (containingBlock && !establishesFixedContainingBlock(containingBlock)) {
    if (isActiveModalDialog(containingBlock)) {
      containingBlock = null;
      break;
    }
    containingBlock = containingBlock.parentElement;
  }

  if (!containingBlock) {
    return { element: null, left: 0, scaleX: 1, scaleY: 1, top: 0 };
  }

  const bounds = containingBlock.getBoundingClientRect();
  const scaleX = containingBlock.offsetWidth > 0 ? bounds.width / containingBlock.offsetWidth : 1;
  const scaleY =
    containingBlock.offsetHeight > 0 ? bounds.height / containingBlock.offsetHeight : 1;
  const safeScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
  const safeScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;

  return {
    element: containingBlock,
    left: bounds.left + containingBlock.clientLeft * safeScaleX,
    scaleX: safeScaleX,
    scaleY: safeScaleY,
    top: bounds.top + containingBlock.clientTop * safeScaleY,
  };
}

export function convertAppSelectPlacementToFixedCoordinateSpace(
  placement: AppSelectPlacement,
  coordinateSpace: AppSelectFixedCoordinateSpace,
): AppSelectPlacement {
  return {
    ...placement,
    left: (placement.left - coordinateSpace.left) / coordinateSpace.scaleX,
    maxHeight: placement.maxHeight / coordinateSpace.scaleY,
    top: (placement.top - coordinateSpace.top) / coordinateSpace.scaleY,
    width: placement.width / coordinateSpace.scaleX,
  };
}
