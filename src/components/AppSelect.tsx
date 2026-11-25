import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/utils/cn";
import type { ControlSize } from "./Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip } from "./Tooltip";
import { focusElementIfUsable } from "../utils/focusRestoration";
import { focusPresentationRuntime } from "../app/inputModality";
import { getNextEnabledIndex } from "./listboxNavigation";
import { scrollAppSelectOptionIntoView } from "./appSelectPlacement";
import { useTransientSurfaceOwnership } from "../utils/transientSurfaceOwnership";

export type AppSelectOption<TValue extends string> = {
  disabled?: boolean;
  label: string;
  value: TValue;
};

type AppSelectAppearance =
  | {
      appearance?: "default";
      triggerIcon?: ReactNode;
    }
  | {
      appearance: "icon-only";
      triggerIcon: ReactNode;
    };

type AppSelectProps<TValue extends string> = AppSelectAppearance & {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  label?: ReactNode;
  onChange: (value: TValue) => void;
  onOpen?: () => void;
  options: Array<AppSelectOption<TValue>>;
  size?: Exclude<ControlSize, "prominent">;
  value: TValue;
};

export function AppSelect<TValue extends string>({
  appearance = "default",
  ariaLabel,
  className = "",
  disabled = false,
  id,
  label,
  onChange,
  onOpen,
  options,
  size = "standard",
  triggerIcon,
  value,
}: AppSelectProps<TValue>) {
  const generatedId = useId();
  const controlId = id ?? `app-select-${generatedId}`;
  const [open, setOpen] = useState(false);
  const [previousDisabled, setPreviousDisabled] = useState(disabled);
  if (previousDisabled !== disabled) {
    setPreviousDisabled(disabled);
    setOpen(false);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const openingIndexRef = useRef<number | null>(null);
  const isOpen = previousDisabled === disabled && open && !disabled;
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const iconOnly = appearance === "icon-only";

  useTransientSurfaceOwnership({
    active: isOpen,
    closeOnModalOpen: true,
    dismissOnOutsidePointer: true,
    elementRef: rootRef,
    kind: "popover",
    onDismiss: (reason) => {
      restoreFocusRef.current = reason === "escape";
      setOpen(false);
    },
    originRef: buttonRef,
    triggerRef: buttonRef,
  });

  // Base UI owns navigation after opening. Match the desktop's first/last and
  // next/previous opening shortcuts without maintaining another active index.
  useLayoutEffect(() => {
    if (!isOpen || openingIndexRef.current === null) return;
    const index = openingIndexRef.current;
    openingIndexRef.current = null;
    const frame = requestAnimationFrame(() => {
      const menu = menuRef.current;
      const option = menu?.querySelectorAll<HTMLElement>('[role="option"]')[index];
      if (menu && option && focusElementIfUsable(option))
        scrollAppSelectOptionIntoView(menu, option);
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  return (
    <div
      className={cn(
        "app-select relative inline-grid max-w-full text-text",
        isOpen ? "z-40" : "z-1",
        iconOnly ? "min-w-0" : "min-w-select-trigger",
        `app-select--${size} app-select--${appearance}`,
        className,
      )}
      ref={rootRef}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && !event.currentTarget.contains(nextTarget)) {
          restoreFocusRef.current = false;
          setOpen(false);
        }
      }}
    >
      {label ? (
        <span
          className="app-select__label mb-control-gap-compact text-muted text-caption font-medium"
          id={`${controlId}-label`}
        >
          {label}
        </span>
      ) : null}
      <Select<TValue>
        disabled={disabled}
        items={options}
        modal={false}
        open={isOpen}
        value={value}
        onValueChange={(next, details) => {
          if (
            next === null ||
            !options.some((option) => option.value === next && !option.disabled)
          ) {
            details.cancel();
            return;
          }
          onChange(next);
        }}
        onOpenChange={(next, details) => {
          if (next && disabled) {
            details.cancel();
            return;
          }
          restoreFocusRef.current =
            !next &&
            (details.reason === "item-press" ||
              details.reason === "escape-key" ||
              details.reason === "trigger-press");
          setOpen(next);
          if (next && !isOpen) onOpen?.();
        }}
      >
        <Tooltip content={iconOnly ? (ariaLabel ?? selectedOption?.label ?? "Select option") : ""}>
          <SelectTrigger
            aria-label={ariaLabel}
            aria-labelledby={label ? `${controlId}-label ${controlId}-button` : undefined}
            iconOnly={iconOnly}
            id={`${controlId}-button`}
            ref={buttonRef}
            size={size}
            type="button"
            onKeyDown={(event) => {
              if (disabled || isOpen) return;
              const key = event.key;
              if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End")
                return;
              const direction = key === "ArrowUp" || key === "End" ? -1 : 1;
              const selected = options.findIndex((option) => option.value === value);
              const start =
                key === "Home"
                  ? options.length - 1
                  : key === "End"
                    ? 0
                    : selected >= 0
                      ? selected
                      : direction === 1
                        ? -1
                        : 0;
              const index = getNextEnabledIndex(options, start, direction);
              if (index < 0) return;
              openingIndexRef.current = index;
              focusPresentationRuntime.markKeyboardNavigation();
              if (key === "Home" || key === "End") {
                event.preventDefault();
                restoreFocusRef.current = false;
                setOpen(true);
                onOpen?.();
              }
            }}
          >
            {triggerIcon ? (
              <span aria-hidden="true" className="app-select__trigger-icon icon-slot text-muted">
                {triggerIcon}
              </span>
            ) : null}
            {!iconOnly ? (
              <SelectValue className="app-select__value min-w-0 wrap-anywhere whitespace-normal">
                {selectedOption?.label ?? "Select"}
              </SelectValue>
            ) : null}
          </SelectTrigger>
        </Tooltip>
        {isOpen ? (
          <SelectContent
            aria-labelledby={`${controlId}-button`}
            ref={menuRef}
            container={rootRef}
            finalFocus={() => (restoreFocusRef.current ? (buttonRef.current ?? false) : false)}
            onKeyDown={(event) => {
              if (event.key === "Tab" && event.shiftKey) {
                // The local portal follows the trigger in DOM order. Start the
                // native backward tab from the trigger, not the popup.
                restoreFocusRef.current = false;
                flushSync(() => setOpen(false));
                focusElementIfUsable(buttonRef.current);
                return;
              }
              if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
                focusPresentationRuntime.markKeyboardNavigation();
            }}
          >
            {options.map((option) => (
              <SelectItem
                disabled={option.disabled}
                key={option.value}
                label={option.label}
                value={option.value}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        ) : null}
      </Select>
    </div>
  );
}
