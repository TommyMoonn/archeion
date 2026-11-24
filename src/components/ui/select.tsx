// Adapted from the shadcn Base UI Select registry component (MIT).
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { cn } from "@/utils/cn";
import {
  APP_SELECT_TRIGGER_GAP,
  APP_SELECT_VIEWPORT_MARGIN,
  getAppSelectFixedScaleY,
} from "../appSelectPlacement";

// The desktop viewport, rather than a scrollable parent, bounds this popup.
const viewportBoundary: Element[] = [];

export const Select = SelectPrimitive.Root;
export function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

export function SelectTrigger({
  className,
  children,
  iconOnly = false,
  size = "standard",
  ...props
}: ComponentProps<"button"> & { iconOnly?: boolean; size?: "compact" | "standard" }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "app-select__trigger flex w-full items-center justify-between gap-select-trigger-gap border-standard border-solid border-line rounded-control bg-surface px-button-compact py-0 text-meta font-medium leading-inherit text-text text-start cursor-pointer transition-select control-hover:border-line-strong control-hover:bg-surface-hover aria-expanded:border-line-strong aria-expanded:bg-surface-raised aria-expanded:text-text-strong disabled:cursor-not-allowed disabled:opacity-55 control-active:border-line-strong control-active:bg-action-neutral-active control-active:text-text-strong",
        size === "compact" ? "min-h-control-compact" : "min-h-control-standard",
        iconOnly &&
          cn("justify-center p-0", size === "compact" ? "w-control-compact" : "w-control-standard"),
        className,
      )}
      {...props}
    >
      {children}
      {!iconOnly && (
        <SelectPrimitive.Icon
          render={<span className="icon-slot icon-slot--compact text-muted" aria-hidden="true" />}
        >
          <ChevronDown />
        </SelectPrimitive.Icon>
      )}
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  children,
  className,
  container,
  ...props
}: SelectPrimitive.Popup.Props & { container: RefObject<HTMLDivElement | null> }) {
  // Keep the popup in its owning DOM surface (native dialog, filter popover,
  // or Reader palette). A body portal would escape those ownership boundaries.
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Positioner
        align="start"
        alignItemWithTrigger={false}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        collisionBoundary={viewportBoundary}
        collisionPadding={APP_SELECT_VIEWPORT_MARGIN}
        positionMethod="fixed"
        side="bottom"
        sideOffset={() =>
          APP_SELECT_TRIGGER_GAP /
          (container.current ? getAppSelectFixedScaleY(container.current) : 1)
        }
        className="z-60 select-positioner-size"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "app-select__menu w-full max-h-select-available overflow-x-hidden overflow-y-auto border-standard border-solid border-line rounded-menu bg-surface-raised p-menu-padding shadow-app-popover",
            className,
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  children,
  className,
  ...props
}: SelectPrimitive.Item.Props & { children: ReactNode }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "app-select__option grid select-option-columns items-center gap-control-gap w-full min-h-control-compact px-control-gap py-control-gap-compact border-0 rounded-small bg-transparent text-muted text-meta font-medium leading-inherit text-start cursor-pointer data-highlighted:not-aria-selected:bg-surface-hover data-highlighted:text-text-strong hover:not-aria-selected:bg-surface-hover hover:text-text-strong aria-selected:bg-surface-raised aria-selected:text-text-strong control-active:bg-action-neutral-active control-active:text-text-strong data-disabled:cursor-not-allowed data-disabled:opacity-55 focus-visible:-outline-offset-2",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText
        render={<span />}
        className="min-w-0 wrap-anywhere whitespace-normal"
      >
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={<span className="icon-slot icon-slot--compact" aria-hidden="true" />}
      >
        <Check strokeWidth={2.25} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
