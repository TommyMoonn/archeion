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
