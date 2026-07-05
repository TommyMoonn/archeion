import {
  CaretDown,
  Check,
} from "@phosphor-icons/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type AppSelectOption<TValue extends string> = {
  disabled?: boolean;
  label: string;
  value: TValue;
};

type AppSelectProps<TValue extends string> = {
  ariaLabel?: string;
  className?: string;
  id?: string;
  label?: ReactNode;
  onChange: (value: TValue) => void;
  options: Array<AppSelectOption<TValue>>;
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

export function AppSelect<TValue extends string>({
  ariaLabel,
  className = "",
  id,
  label,
  onChange,
  options,
  value,
}: AppSelectProps<TValue>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : 0,
  );
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, selectedIndex]);

  function chooseOption(option: AppSelectOption<TValue>) {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = getNextEnabledIndex(
        options,
        open ? activeIndex : selectedIndex,
        direction,
      );

      if (nextIndex >= 0) {
        setActiveIndex(nextIndex);
        setOpen(true);
      }
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const startIndex = event.key === "Home" ? options.length - 1 : 0;
      const direction = event.key === "Home" ? 1 : -1;
      const nextIndex = getNextEnabledIndex(options, startIndex, direction);
      if (nextIndex >= 0) {
        setActiveIndex(nextIndex);
        setOpen(true);
      }
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen(true);
        return;
      }

      const activeOption = options[activeIndex];
      if (activeOption) {
        chooseOption(activeOption);
      }
    }
  }

  return (
    <div className={`app-select ${className}`.trim()} ref={rootRef}>
      {label ? (
        <span className="app-select__label" id={id ? `${id}-label` : undefined}>
          {label}
        </span>
      ) : null}
      <button
        aria-controls={id ? `${id}-menu` : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={label && id ? `${id}-label ${id}-button` : undefined}
        className="app-select__trigger"
        id={id ? `${id}-button` : undefined}
        onClick={() => {
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
        ref={buttonRef}
        type="button"
      >
        <span>{selectedOption?.label ?? "Select"}</span>
        <CaretDown aria-hidden="true" size={13} weight="bold" />
      </button>
      {open ? (
        <div
          className="app-select__menu"
          id={id ? `${id}-menu` : undefined}
          role="listbox"
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <button
              aria-disabled={option.disabled || undefined}
              aria-selected={option.value === value}
              className="app-select__option"
              data-active={index === activeIndex || undefined}
              disabled={option.disabled}
              key={option.value}
              onClick={() => chooseOption(option)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <Check aria-hidden="true" size={14} weight="bold" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
