export type TooltipPlacement = "top" | "right" | "bottom" | "left";

type TooltipPositionInput = {
  preferredPlacement: TooltipPlacement;
  tooltipHeight: number;
  tooltipWidth: number;
  triggerRect: Pick<DOMRect, "bottom" | "height" | "left" | "right" | "top" | "width">;
  viewportHeight: number;
  viewportWidth: number;
};

export type TooltipPosition = {
  left: number;
  placement: TooltipPlacement;
  top: number;
};

const TOOLTIP_GAP = 8;
const TOOLTIP_VIEWPORT_MARGIN = 8;

function oppositePlacement(placement: TooltipPlacement): TooltipPlacement {
  switch (placement) {
    case "top":
      return "bottom";
    case "right":
      return "left";
    case "bottom":
      return "top";
    case "left":
      return "right";
  }
}

function availableSpace(
  placement: TooltipPlacement,
  triggerRect: TooltipPositionInput["triggerRect"],
  viewportWidth: number,
  viewportHeight: number,
): number {
  switch (placement) {
    case "top":
      return triggerRect.top - TOOLTIP_VIEWPORT_MARGIN;
    case "right":
      return viewportWidth - triggerRect.right - TOOLTIP_VIEWPORT_MARGIN;
    case "bottom":
      return viewportHeight - triggerRect.bottom - TOOLTIP_VIEWPORT_MARGIN;
    case "left":
      return triggerRect.left - TOOLTIP_VIEWPORT_MARGIN;
  }
}

function requiredPrimarySpace(
  placement: TooltipPlacement,
  tooltipWidth: number,
  tooltipHeight: number,
): number {
  return (
    (placement === "left" || placement === "right" ? tooltipWidth : tooltipHeight) + TOOLTIP_GAP
  );
}

export function resolveTooltipPosition({
  preferredPlacement,
  tooltipHeight,
  tooltipWidth,
  triggerRect,
  viewportHeight,
  viewportWidth,
}: TooltipPositionInput): TooltipPosition {
  const opposite = oppositePlacement(preferredPlacement);
  const preferredSpace = availableSpace(
    preferredPlacement,
    triggerRect,
    viewportWidth,
    viewportHeight,
  );
  const oppositeSpace = availableSpace(opposite, triggerRect, viewportWidth, viewportHeight);
  const requiredSpace = requiredPrimarySpace(preferredPlacement, tooltipWidth, tooltipHeight);
  const placement =
    preferredSpace < requiredSpace && oppositeSpace > preferredSpace
      ? opposite
      : preferredPlacement;

  let left: number;
  let top: number;

  switch (placement) {
    case "top":
      left = triggerRect.left + (triggerRect.width - tooltipWidth) / 2;
      top = triggerRect.top - tooltipHeight - TOOLTIP_GAP;
      break;
    case "right":
      left = triggerRect.right + TOOLTIP_GAP;
      top = triggerRect.top + (triggerRect.height - tooltipHeight) / 2;
      break;
    case "bottom":
      left = triggerRect.left + (triggerRect.width - tooltipWidth) / 2;
      top = triggerRect.bottom + TOOLTIP_GAP;
      break;
    case "left":
      left = triggerRect.left - tooltipWidth - TOOLTIP_GAP;
      top = triggerRect.top + (triggerRect.height - tooltipHeight) / 2;
      break;
  }

  const maximumLeft = Math.max(
    TOOLTIP_VIEWPORT_MARGIN,
    viewportWidth - tooltipWidth - TOOLTIP_VIEWPORT_MARGIN,
  );
  const maximumTop = Math.max(
    TOOLTIP_VIEWPORT_MARGIN,
    viewportHeight - tooltipHeight - TOOLTIP_VIEWPORT_MARGIN,
  );

  return {
    left: Math.min(Math.max(left, TOOLTIP_VIEWPORT_MARGIN), maximumLeft),
    placement,
    top: Math.min(Math.max(top, TOOLTIP_VIEWPORT_MARGIN), maximumTop),
  };
}
