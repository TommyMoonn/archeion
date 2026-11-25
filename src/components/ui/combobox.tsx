// Adapted from the shadcn Base UI Combobox registry component (MIT).
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import type { RefObject } from "react";
import { cn } from "@/utils/cn";
import {
  APP_SELECT_TRIGGER_GAP,
  APP_SELECT_VIEWPORT_MARGIN,
  getAppSelectFixedScaleY,
} from "../appSelectPlacement";

const viewportBoundary: Element[] = [];

export const Combobox = ComboboxPrimitive.Root;
export const ComboboxList = ComboboxPrimitive.List;
export const ComboboxEmpty = ComboboxPrimitive.Empty;

export function ComboboxTrigger({
  children,
  className,
  size = "standard",
  ...props
}: ComboboxPrimitive.Trigger.Props & {
  size?: "compact" | "standard";
  ref?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "app-select__trigger flex w-full min-w-0 items-center justify-between gap-select-trigger-gap border-standard border-solid border-line rounded-control bg-surface px-button-compact py-0 text-meta font-medium leading-inherit text-text text-start cursor-pointer transition-select control-hover:border-line-strong control-hover:bg-surface-hover aria-expanded:border-line-strong aria-expanded:bg-surface-raised aria-expanded:text-text-strong disabled:cursor-not-allowed disabled:opacity-55 control-active:border-line-strong control-active:bg-action-neutral-active control-active:text-text-strong",
        size === "compact" ? "min-h-control-compact" : "min-h-control-standard",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.Icon
        render={<span className="icon-slot icon-slot--compact text-muted" aria-hidden="true" />}
      >
        <ChevronDown />
      </ComboboxPrimitive.Icon>
    </ComboboxPrimitive.Trigger>
  );
}

export function ComboboxContent({
  children,
  className,
  container,
  ...props
}: ComboboxPrimitive.Popup.Props & { container: RefObject<HTMLDivElement | null> }) {
  return (
    <ComboboxPrimitive.Portal container={container}>
      <ComboboxPrimitive.Positioner
        align="start"
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        collisionBoundary={viewportBoundary}
        collisionPadding={APP_SELECT_VIEWPORT_MARGIN}
        positionMethod="fixed"
        side="bottom"
        sideOffset={() =>
          APP_SELECT_TRIGGER_GAP /
          (container.current ? getAppSelectFixedScaleY(container.current) : 1)
        }
        className="z-60 font-picker-positioner-size"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "app-select__menu font-picker__popover flex w-full max-h-font-picker-available flex-col overflow-hidden border-standard border-solid border-line rounded-menu bg-surface-raised shadow-app-popover",
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

export function ComboboxInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props & { ref?: RefObject<HTMLInputElement | null> }) {
  return (
    <div className="font-picker__header shrink-0 border-0 border-b border-solid border-font-picker-divider p-font-picker-inset">
      <div className="font-picker__search flex min-h-font-picker-search w-full min-w-0 items-center px-control-gap bg-transparent">
        <ComboboxPrimitive.Input
          data-slot="combobox-input"
          className={cn(
            "font-picker-search-input w-full min-w-0 border-0 rounded-none bg-transparent p-0 text-meta text-text outline-none placeholder:text-muted",
            className,
          )}
          {...props}
        />
      </div>
    </div>
  );
}

export function ComboboxItem({
  children,
  className,
  ...props
}: ComboboxPrimitive.Item.Props & { className?: string }) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "app-select__option grid select-option-columns items-center gap-control-gap w-full min-h-control-compact px-control-gap py-control-gap-compact border-0 rounded-small bg-transparent text-muted text-meta font-medium leading-inherit text-start cursor-pointer data-highlighted:bg-surface-hover data-highlighted:text-text-strong hover:bg-surface-hover hover:text-text-strong aria-selected:bg-surface-raised aria-selected:text-text-strong control-active:bg-action-neutral-active control-active:text-text-strong data-disabled:cursor-not-allowed font-picker-keyboard-outline",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 wrap-anywhere whitespace-normal">{children}</span>
      <ComboboxPrimitive.ItemIndicator
        render={<span className="icon-slot icon-slot--compact" aria-hidden="true" />}
      >
        <Check strokeWidth={2.25} />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}
