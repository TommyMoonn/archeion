import { Check, ChevronDown } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { focusElementIfUsable } from "../utils/focusRestoration";
import { useTransientSurfaceOwnership } from "../utils/transientSurfaceOwnership";
import type { ControlSize } from "./Button";
import { Input } from "./Input";
import { getNextEnabledIndex } from "./listboxNavigation";
import { useAppSelectPlacement } from "./useAppSelectPlacement";

export type FontPickerSelection<TValue extends string = string> =
  { kind: "pinned"; value: TValue } | { kind: "system"; family: string };

export type FontPickerPinnedOption<TValue extends string = string> = {
  label: string;
  value: TValue;
};

export type FontPickerProps<TValue extends string = string> = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  /** Normalized, session-cached family labels supplied by the catalog owner. */
  installedFamilies: readonly string[];
  onChange: (selection: FontPickerSelection<TValue>) => void;
  pinnedOptions: readonly FontPickerPinnedOption<TValue>[];
  size?: Exclude<ControlSize, "prominent">;
  suppressInstalledDuplicates?: boolean;
  value: FontPickerSelection<TValue>;
};

type FontRow<TValue extends string> = {
  disabled?: boolean;
  key: string;
  label: string;
  selection: FontPickerSelection<TValue>;
};

const MENU_HEIGHT = 360;

function selectionKey(selection: FontPickerSelection<string>): string {
  return selection.kind === "pinned"
    ? `pinned:${selection.value}`
    : `system:${selection.family.toLowerCase()}`;
}

export function FontPicker<TValue extends string>({
  ariaLabel,
  className = "",
  disabled = false,
  id,
  installedFamilies,
  onChange,
  pinnedOptions,
  size = "standard",
  suppressInstalledDuplicates = false,
  value,
}: FontPickerProps<TValue>) {
  const generatedId = useId();
  const controlId = id ?? `font-picker-${generatedId}`;
  const listId = `${controlId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<{ query: string; activeKey: string | null } | null>(null);
  const [previousDisabled, setPreviousDisabled] = useState(disabled);
  if (previousDisabled !== disabled) {
    setPreviousDisabled(disabled);
    setSession(null);
  }
  const isOpen = session !== null && !disabled && previousDisabled === disabled;
  const selectedKey = selectionKey(value);

  const rows = useMemo(() => {
    const pinnedLabels = new Set(pinnedOptions.map((option) => option.label.toLowerCase()));
    const result: FontRow<TValue>[] = pinnedOptions.map((option) => ({
      key: selectionKey({ kind: "pinned", value: option.value }),
      label: option.label,
      selection: { kind: "pinned", value: option.value },
    }));
    // Do not mutate or re-normalize the catalog. Its owner supplies unique family labels.
    const sortedFamilies = [...installedFamilies].sort((left, right) => {
      const a = left.toLowerCase();
      const b = right.toLowerCase();
      return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
    });
    for (const family of sortedFamilies) {
      if (suppressInstalledDuplicates && pinnedLabels.has(family.toLowerCase())) continue;
      result.push({
        key: selectionKey({ kind: "system", family }),
        label: family,
        selection: { kind: "system", family },
      });
    }
    return result;
  }, [installedFamilies, pinnedOptions, suppressInstalledDuplicates]);

  const unavailable =
    value.kind === "system" &&
    !installedFamilies.some((family) => family.toLowerCase() === value.family.toLowerCase());
  const selectedLabel = unavailable
    ? `${value.family} (Unavailable)`
    : (rows.find((row) => row.key === selectedKey)?.label ??
      (value.kind === "system" ? value.family : value.value));
  const query = session?.query.trim().toLowerCase() ?? "";
  const availableRows: FontRow<TValue>[] = unavailable
    ? [...rows, { disabled: true, key: selectedKey, label: selectedLabel, selection: value }]
    : rows;
  const visibleRows = availableRows.filter((row) => row.label.toLowerCase().includes(query));
  const requestedActive = visibleRows.findIndex(
    (row) => row.key === session?.activeKey && !row.disabled,
  );
  const selectedIndex = visibleRows.findIndex((row) => row.key === selectedKey && !row.disabled);
  const activeIndex =
    requestedActive >= 0
      ? requestedActive
      : !query && selectedIndex >= 0
        ? selectedIndex
        : getNextEnabledIndex(visibleRows, -1, 1);
  const optionId = (index: number) => `${controlId}-option-${index}`;
  const activeOptionId = isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined;
  const menuPlacement = useAppSelectPlacement({
    activeOptionId,
    contentRevision: JSON.stringify(visibleRows.map((row) => [row.key, row.label, row.disabled])),
    maxMenuHeight: MENU_HEIGHT,
    menuRef,
    open: isOpen,
    scrollRef: listRef,
    triggerRef: buttonRef,
  });

  const readyToFocus = isOpen && menuPlacement !== null;
  useLayoutEffect(() => {
    if (readyToFocus) focusElementIfUsable(inputRef.current);
  }, [readyToFocus]);

  useTransientSurfaceOwnership({
    active: isOpen,
    closeOnModalOpen: true,
    dismissOnOutsidePointer: true,
    elementRef: rootRef,
    kind: "popover",
    onDismiss: (reason) => {
      setSession(null);
      if (reason === "escape") focusElementIfUsable(buttonRef.current);
    },
    originRef: buttonRef,
    triggerRef: buttonRef,
  });

  function choose(row: FontRow<TValue>) {
    if (row.disabled) return;
    onChange(row.selection);
    setSession(null);
    focusElementIfUsable(buttonRef.current);
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = getNextEnabledIndex(
        visibleRows,
        activeIndex < 0 ? (direction === 1 ? -1 : 0) : activeIndex,
        direction,
      );
      if (next >= 0)
        setSession((current) => current && { ...current, activeKey: visibleRows[next].key });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0) choose(visibleRows[activeIndex]);
    }
    // Home, End, Space and horizontal arrows retain native search-field editing behavior.
  }

  return (
    <div
      className={`app-select app-select--${size} app-select--default font-picker ${className}`.trim()}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setSession(null);
        }
      }}
      ref={rootRef}
    >
      <button
        aria-controls={isOpen ? listId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`${ariaLabel}: ${selectedLabel}`}
        className="app-select__trigger"
        disabled={disabled}
        id={`${controlId}-button`}
        onClick={() => setSession(isOpen ? null : { query: "", activeKey: null })}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setSession({ query: "", activeKey: null });
          }
        }}
        ref={buttonRef}
        title={selectedLabel}
        type="button"
      >
        <span className="app-select__value">{selectedLabel}</span>
        <span aria-hidden="true" className="icon-slot icon-slot--compact">
          <ChevronDown />
        </span>
      </button>
      {isOpen ? (
        <div
          className="app-select__menu font-picker__popover"
          data-placement={menuPlacement?.placement}
          ref={menuRef}
          style={
            menuPlacement
              ? {
                  left: menuPlacement.left,
                  maxHeight: Math.min(MENU_HEIGHT, menuPlacement.maxHeight),
                  top: menuPlacement.top,
                  visibility: "visible",
                  width: menuPlacement.width,
                }
              : { visibility: "hidden" }
          }
        >
          <Input
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            autoComplete="off"
            className="font-picker__search"
            label={`Search fonts for ${ariaLabel}`}
            onChange={(event) => setSession({ query: event.target.value, activeKey: null })}
            onKeyDown={navigate}
            placeholder="Search fonts…"
            ref={inputRef}
            role="combobox"
            size="standard"
            spellCheck={false}
            type="search"
            value={session.query}
          />
          <div
            aria-label={ariaLabel}
            className="font-picker__list"
            id={listId}
            ref={listRef}
            role="listbox"
            tabIndex={-1}
          >
            {visibleRows.map((row, index) => (
              <button
                aria-disabled={row.disabled || undefined}
                aria-selected={row.key === selectedKey}
                className="app-select__option"
                data-active={index === activeIndex || undefined}
                disabled={row.disabled}
                id={optionId(index)}
                key={row.key}
                onClick={() => choose(row)}
                onMouseEnter={() => {
                  if (!row.disabled)
                    setSession((current) => current && { ...current, activeKey: row.key });
                }}
                onPointerDown={(event) => event.preventDefault()}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <span>{row.label}</span>
                {row.key === selectedKey ? (
                  <span aria-hidden="true" className="icon-slot icon-slot--compact">
                    <Check strokeWidth={2.25} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div
            aria-atomic="true"
            className={visibleRows.length ? "sr-only" : "font-picker__empty"}
            role="status"
          >
            {visibleRows.length ? "" : "No fonts found."}
          </div>
        </div>
      ) : null}
    </div>
  );
}
