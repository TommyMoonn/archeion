// Adapted from the shadcn Base UI Popover registry component (MIT).
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

const viewportBoundary: Element[] = [];

export function PopoverContent({
  container,
  align = "start",
  sideOffset = 8,
  className,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Popup> &
  Pick<PopoverPrimitive.Portal.Props, "container"> &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "sideOffset">) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Positioner
        align={align}
        side="bottom"
        sideOffset={sideOffset}
        collisionBoundary={viewportBoundary}
        collisionPadding={8}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        positionMethod="fixed"
        className="z-60 w-max max-w-full"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "grid border-standard border-solid border-line rounded-menu bg-surface-main-raised shadow-app-popover",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}
