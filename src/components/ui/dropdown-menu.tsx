// Adapted from the shadcn Base UI Dropdown Menu registry component (MIT).
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

const viewportBoundary: Element[] = [];
export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuItem = MenuPrimitive.Item;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

const menuSurfaceClassName =
  "menu-popover grid w-max border-standard border-solid border-line rounded-menu bg-surface-raised p-menu-padding shadow-app-popover";

export function DropdownMenuContent({
  anchor,
  container,
  sideOffset = 4,
  side = "bottom",
  align = "start",
  className,
  ref,
  ...props
}: ComponentProps<typeof MenuPrimitive.Popup> &
  Pick<MenuPrimitive.Positioner.Props, "anchor" | "sideOffset" | "side" | "align"> &
  Pick<MenuPrimitive.Portal.Props, "container">) {
  return (
    <MenuPrimitive.Portal container={container}>
      <MenuPrimitive.Positioner
        anchor={anchor}
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionBoundary={viewportBoundary}
        collisionPadding={8}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        sticky
        positionMethod="fixed"
        className="z-1000 w-max"
      >
        <MenuPrimitive.Popup
          ref={ref}
          data-slot="dropdown-menu-content"
          finalFocus={false}
          className={cn(
            menuSurfaceClassName,
            "min-w-menu-viewport-min max-w-menu-viewport",
            "context-menu max-h-menu-viewport-height overflow-y-auto overscroll-contain",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}
