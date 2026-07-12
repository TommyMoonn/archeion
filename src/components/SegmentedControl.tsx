import { type KeyboardEvent, type ReactNode, useRef } from "react";
import type { ControlSize } from "./Button";

export type SegmentedControlOption<TValue extends string> = {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  value: TValue;
};

type SegmentedControlProps<TValue extends string> = {
  className?: string;
  label: string;
  onChange: (value: TValue) => void;
  options: Array<SegmentedControlOption<TValue>>;
  size?: Exclude<ControlSize, "prominent">;
  value: TValue;
};

function nextEnabledIndex<TValue extends string>(
  options: Array<SegmentedControlOption<TValue>>,
  startIndex: number,
  direction: 1 | -1,
) {
  if (!options.length) {
    return -1;
  }

  let nextIndex = startIndex;
  for (let count = 0; count < options.length; count += 1) {
    nextIndex = (nextIndex + direction + options.length) % options.length;
    if (!options[nextIndex]?.disabled) {
      return nextIndex;
    }
  }

  return -1;
}

export function SegmentedControl<TValue extends string>({
  className = "",
  label,
  onChange,
  options,
  size = "compact",
  value,
}: SegmentedControlProps<TValue>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  function focusAndChange(nextIndex: number) {
    const option = options[nextIndex];
    if (!option || option.disabled) {
      return;
    }

    onChange(option.value);
    buttonRefs.current[nextIndex]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = Math.max(selectedIndex, 0);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = nextEnabledIndex(options, currentIndex, 1);
      if (nextIndex >= 0) focusAndChange(nextIndex);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = nextEnabledIndex(options, currentIndex, -1);
      if (nextIndex >= 0) focusAndChange(nextIndex);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const startIndex = event.key === "Home" ? options.length - 1 : 0;
      const direction = event.key === "Home" ? 1 : -1;
      const nextIndex = nextEnabledIndex(options, startIndex, direction);
      if (nextIndex >= 0) focusAndChange(nextIndex);
    }
  }

  return (
    <div
      aria-label={label}
      className={`segmented-control segmented-control--${size} ${className}`.trim()}
      onKeyDown={handleKeyDown}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const selected = option.value === value;

        return (
          <button
            aria-checked={selected}
            className="segmented-control__option"
            disabled={option.disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
            role="radio"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {option.icon ? (
              <span aria-hidden="true" className="segmented-control__icon icon-slot">
                {option.icon}
              </span>
            ) : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
