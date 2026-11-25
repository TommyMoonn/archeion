import { type KeyboardEvent, type ReactNode } from "react";
import { focusPresentationRuntime } from "../app/inputModality";
import type { ControlSize } from "./Button";
import { Tooltip } from "./Tooltip";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { cn } from "@/utils/cn";

export type SegmentedControlOption<TValue extends string> = {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  value: TValue;
};

type SegmentedControlProps<TValue extends string> = {
  appearance?: "default" | "icon-only";
  ariaDescribedBy?: string;
  className?: string;
  label: string;
  onChange: (value: TValue) => void;
  options: Array<SegmentedControlOption<TValue>>;
  size?: Exclude<ControlSize, "prominent">;
  value: TValue;
};

export function SegmentedControl<TValue extends string>({
  appearance = "default",
  ariaDescribedBy,
  className = "",
  label,
  onChange,
  options,
  size = "compact",
  value,
}: SegmentedControlProps<TValue>) {
  const iconOnly = appearance === "icon-only";

  // Base UI owns arrow navigation and selection; Home/End are an Archeion extension.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Home" && event.key !== "End") return;
    const enabled = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="radio"]:not(:disabled)',
      ),
    );
    const target = event.key === "Home" ? enabled[0] : enabled.at(-1);
    if (!target) return;
    event.preventDefault();
    focusPresentationRuntime.markKeyboardNavigation();
    target.focus();
    target.click();
  }

  return (
    <RadioGroup<TValue>
      aria-describedby={ariaDescribedBy}
      aria-label={label}
      className={cn(
        "segmented-control inline-grid grid-flow-col auto-cols-fr",
        iconOnly
          ? "segmented-control--icon-only gap-control-inset p-0 border-0 bg-transparent"
          : "gap-segment-inset p-segment-inset border-standard border-solid border-line rounded-control bg-canvas-deep",
        className,
      )}
      onKeyDown={handleKeyDown}
      onKeyDownCapture={(event) => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          focusPresentationRuntime.markKeyboardNavigation();
        }
      }}
      onValueChange={(next) => onChange(next)}
      value={value}
    >
      {options.map((option) => {
        const optionButton = (
          <RadioGroupItem
            aria-label={iconOnly ? option.label : undefined}
            disabled={option.disabled}
            iconOnly={iconOnly}
            key={option.value}
            size={size}
            value={option.value}
          >
            {option.icon ? (
              <span
                aria-hidden="true"
                className={cn(
                  "segmented-control__icon",
                  iconOnly
                    ? "inline-grid shrink-0 place-items-center size-segment-glyph *:size-segment-glyph"
                    : "icon-slot",
                )}
              >
                {option.icon}
              </span>
            ) : null}
            {iconOnly ? null : <span>{option.label}</span>}
          </RadioGroupItem>
        );
        return iconOnly ? (
          <Tooltip content={option.label} key={option.value}>
            {optionButton}
          </Tooltip>
        ) : (
          optionButton
        );
      })}
    </RadioGroup>
  );
}
