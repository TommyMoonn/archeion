import { ChevronDown, Check } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useMemo, useRef, useState } from "react";
import type { ControlSize } from "./Button";
import { useAppSelectPlacement } from "./useAppSelectPlacement";
import { focusElementIfUsable } from "../utils/focusRestoration";
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

function getNextEnabledIndex<TValue extends string>(
  options: Array<AppSelectOption<TValue>>,
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

function getSelectedOrFirstEnabledIndex<TValue extends string>(
  options: Array<AppSelectOption<TValue>>,
  selectedIndex: number,
): number {
  if (selectedIndex >= 0 && !options[selectedIndex]?.disabled) {
    return selectedIndex;
  }
  return getNextEnabledIndex(options, -1, 1);
}

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
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const resolvedActiveIndex =
    activeIndex >= 0 && !options[activeIndex]?.disabled
      ? activeIndex
      : getSelectedOrFirstEnabledIndex(options, selectedIndex);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  );
  const optionId = (index: number) => `${controlId}-option-${index}`;
  const isOpen = previousDisabled === disabled && open && !disabled;
  const activeOptionId =
    isOpen && resolvedActiveIndex >= 0 ? optionId(resolvedActiveIndex) : undefined;
  const contentRevision = options
    .map((option) => `${option.value}\u0000${option.label}\u0000${option.disabled ? "1" : "0"}`)
    .join("\u0001");
  const menuPlacement = useAppSelectPlacement({
    activeOptionId,
    contentRevision,
    menuRef,
    open: isOpen,
    triggerRef: buttonRef,
  });

  useTransientSurfaceOwnership({
    active: isOpen,
    closeOnModalOpen: true,
    dismissOnOutsidePointer: true,
    elementRef: rootRef,
    kind: "popover",
    onDismiss: (reason) => {
      setOpen(false);
      if (reason === "escape") focusElementIfUsable(buttonRef.current);
    },
    originRef: buttonRef,
    triggerRef: buttonRef,
  });

  function chooseOption(option: AppSelectOption<TValue>) {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    setOpen(false);
    focusElementIfUsable(buttonRef.current);
  }

  function openListbox(nextActiveIndex: number): void {
    setActiveIndex(nextActiveIndex);
    if (isOpen) return;
    setOpen(true);
    onOpen?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const startIndex = isOpen
        ? resolvedActiveIndex
        : selectedIndex >= 0
          ? selectedIndex
          : direction === 1
            ? -1
            : 0;
      const nextIndex = getNextEnabledIndex(options, startIndex, direction);

      if (nextIndex >= 0) {
        openListbox(nextIndex);
      }
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const startIndex = event.key === "Home" ? options.length - 1 : 0;
      const direction = event.key === "Home" ? 1 : -1;
      const nextIndex = getNextEnabledIndex(options, startIndex, direction);
      if (nextIndex >= 0) {
        openListbox(nextIndex);
      }
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) {
        openListbox(getSelectedOrFirstEnabledIndex(options, selectedIndex));
        return;
      }

      const activeOption = options[resolvedActiveIndex];
      if (activeOption) {
        chooseOption(activeOption);
      }
    }
  }

  return (
    <div
      className={`app-select app-select--${size} app-select--${appearance} ${className}`.trim()}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
      ref={rootRef}
    >
      {label ? (
        <span className="app-select__label" id={`${controlId}-label`}>
          {label}
        </span>
      ) : null}
      <button
        aria-activedescendant={activeOptionId}
        aria-autocomplete="none"
        aria-controls={`${controlId}-menu`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={label ? `${controlId}-label ${controlId}-button` : undefined}
        className="app-select__trigger"
        disabled={disabled}
        id={`${controlId}-button`}
        onClick={() => {
          if (isOpen) {
            setOpen(false);
            return;
          }
          openListbox(getSelectedOrFirstEnabledIndex(options, selectedIndex));
        }}
        onKeyDown={handleKeyDown}
        ref={buttonRef}
        role="combobox"
        type="button"
      >
        {triggerIcon ? (
          <span aria-hidden="true" className="app-select__trigger-icon icon-slot">
            {triggerIcon}
          </span>
        ) : null}
        {appearance === "default" ? (
          <>
            <span className="app-select__value">{selectedOption?.label ?? "Select"}</span>
            <span aria-hidden="true" className="icon-slot icon-slot--compact">
              <ChevronDown strokeWidth={2.25} />
            </span>
          </>
        ) : null}
      </button>
      {isOpen ? (
        <div
          className="app-select__menu"
          data-placement={menuPlacement?.placement}
          id={`${controlId}-menu`}
          aria-labelledby={`${controlId}-button`}
          ref={menuRef}
          role="listbox"
          style={
            menuPlacement
              ? {
                  left: menuPlacement.left,
                  maxHeight: menuPlacement.maxHeight,
                  top: menuPlacement.top,
                  visibility: "visible",
                  width: menuPlacement.width,
                }
              : { visibility: "hidden" }
          }
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <button
              aria-disabled={option.disabled || undefined}
              aria-selected={option.value === value}
              className="app-select__option"
              data-active={index === resolvedActiveIndex || undefined}
              disabled={option.disabled}
              id={optionId(index)}
              key={option.value}
              onClick={() => chooseOption(option)}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <span aria-hidden="true" className="icon-slot icon-slot--compact">
                  <Check strokeWidth={2.25} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
