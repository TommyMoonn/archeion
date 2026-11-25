// Adapted from the shadcn Base UI Tooltip registry component (MIT).
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/utils/cn";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

const viewportBoundary: Element[] = [];

export function TooltipContent({
  anchor,
  container,
  side = "top",
  className,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "anchor" | "side"> &
  Pick<TooltipPrimitive.Portal.Props, "container">) {
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Positioner
        anchor={anchor}
        align="center"
        side={side}
        sideOffset={8}
        collisionBoundary={viewportBoundary}
        collisionPadding={8}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        positionMethod="fixed"
        className="pointer-events-none z-1200 w-max"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          role="tooltip"
          className={cn(
            "app-tooltip pointer-events-none w-max max-w-tooltip-viewport data-[side=left]:max-w-tooltip-side data-[side=right]:max-w-tooltip-side whitespace-normal wrap-anywhere border-standard border-solid border-line rounded-small bg-surface-raised px-control-gap py-control-gap-compact text-caption text-text-strong text-center shadow-app-tooltip origin-bottom data-[side=right]:origin-left data-[side=bottom]:origin-top data-[side=left]:origin-right motion-safe:app-motion:animate-tooltip-enter",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
