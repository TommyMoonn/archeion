// Adapted from the shadcn Base UI Context Menu registry component (MIT).
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { ComponentProps } from "react";
import { DropdownMenu, DropdownMenuContent } from "./dropdown-menu";

// Base UI's ContextMenu.Root imposes modal focus trapping. Archeion's externally
// invoked menus must allow outside pointer focus and Tab to continue at the origin.
// The context-menu popup/item/positioner are the same Menu primitives in Base UI.
export const ContextMenu = DropdownMenu;
export const ContextMenuItem = ContextMenuPrimitive.Item;

export function ContextMenuContent(props: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent {...props} data-slot="context-menu-content" sideOffset={0} />;
}
