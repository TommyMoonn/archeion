import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { focusElementIfUsable } from "../utils/focusRestoration";
import { useTransientSurfaceOwnership } from "../utils/transientSurfaceOwnership";
import type { ControlSize } from "./Button";
import { Tooltip } from "./Tooltip";
import { scrollAppSelectOptionIntoView } from "./appSelectPlacement";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "./ui/combobox";

export type FontPickerSelection<TValue extends string = string> =
  { kind: "pinned"; value: TValue } | { kind: "system"; family: string };

export type FontPickerPinnedOption<TValue extends string = string> = {
  label: string;
  value: TValue;
};

export type FontPickerProps<TValue extends string = string> = {
  ariaLabel: string;
  /** Unknown availability must not be presented as an unavailable saved family. */
  catalogLoading?: boolean;
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

function selectionKey(selection: FontPickerSelection<string>): string {
  return selection.kind === "pinned"
    ? `pinned:${selection.value}`
    : `system:${selection.family.toLowerCase()}`;
}

export function FontPicker<TValue extends string>({
  ariaLabel,
  catalogLoading = false,
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
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [previousDisabled, setPreviousDisabled] = useState(disabled);
  if (previousDisabled !== disabled) {
    setPreviousDisabled(disabled);
    setOpen(false);
    setQuery("");
    setKeyboardActive(false);
  }
  const isOpen = open && !disabled && previousDisabled === disabled;
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
    !catalogLoading &&
    value.kind === "system" &&
    !installedFamilies.some((family) => family.toLowerCase() === value.family.toLowerCase());
  const selectedLabel = unavailable
    ? `${value.family} (Unavailable)`
    : (rows.find((row) => row.key === selectedKey)?.label ??
      (value.kind === "system" ? value.family : value.value));
  const availableRows = useMemo(
    () =>
      unavailable
        ? [...rows, { disabled: true, key: selectedKey, label: selectedLabel, selection: value }]
        : rows,
    [rows, unavailable, selectedKey, selectedLabel, value],
  );
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return availableRows.filter((row) => row.label.toLowerCase().includes(normalized));
  }, [availableRows, query]);
  const selectedRow = availableRows.find((row) => row.key === selectedKey) ?? null;

  // Base UI owns virtual focus. When opening or replacing the filtered list,
  // its active item can be cleared during item registration. Restore the
  // opening/query anchor through the primitive's existing hover interaction.
  useLayoutEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    function restoreHighlight() {
      if (cancelled) return;
      const list = listRef.current;
      const input = inputRef.current;
      if (!list || !input) return;
      const active = input.ownerDocument.getElementById(
        input.getAttribute("aria-activedescendant") ?? "",
      );
      if (active && list.contains(active) && active.getAttribute("aria-disabled") !== "true")
        return;
      const first = list.querySelector<HTMLElement>('[role="option"]:not([aria-disabled="true"])');
      const selected =
        !query &&
        list.querySelector<HTMLElement>('[aria-selected="true"]:not([aria-disabled="true"])');
      const row = selected || first;
      if (!row) return;
      row.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      scrollAppSelectOptionIntoView(list, row);
    }
    // Wait for the primitive's layout registration before reading its active row.
    queueMicrotask(restoreHighlight);
    const frame = requestAnimationFrame(restoreHighlight);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [isOpen, query]);

  function close(restoreFocus: boolean) {
    if (restoreFocus) focusElementIfUsable(buttonRef.current);
    setOpen(false);
    setQuery("");
    setKeyboardActive(false);
  }

  useTransientSurfaceOwnership({
    active: isOpen,
    closeOnModalOpen: true,
    dismissOnOutsidePointer: true,
    elementRef: rootRef,
    kind: "popover",
    onDismiss: (reason) => {
      close(reason === "escape");
    },
    originRef: buttonRef,
    triggerRef: buttonRef,
  });

  return (
    <div
      className={cn(
        "app-select relative inline-grid max-w-full min-w-select-trigger text-text font-picker",
        isOpen ? "z-40" : "z-1",
        `app-select--${size} app-select--default`,
        className,
      )}
      ref={rootRef}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          close(false);
      }}
    >
      <Combobox<FontRow<TValue>>
        autoHighlight
        disabled={disabled}
        filteredItems={visibleRows}
        items={availableRows}
        inputValue={query}
        isItemEqualToValue={(row, selected) => row.key === selected.key}
        itemToStringLabel={(row) => row.label}
        itemToStringValue={(row) => row.key}
        modal={false}
        open={isOpen}
        value={selectedRow}
        onInputValueChange={(next) => {
          setQuery(next);
          setKeyboardActive(false);
        }}
        onItemHighlighted={(_, details) => setKeyboardActive(details.reason === "keyboard")}
        onValueChange={(next, details) => {
          if (!next || next.disabled || details.reason !== "item-press") {
            details.cancel();
            return;
          }
          onChange(next.selection);
        }}
        onOpenChange={(next, details) => {
          if (next) {
            if (disabled) {
              details.cancel();
              return;
            }
            setOpen(true);
          } else {
            close(["item-press", "escape-key", "trigger-press"].includes(details.reason));
          }
        }}
      >
        <Tooltip content={selectedLabel} onlyWhenTruncated=".app-select__value">
          <ComboboxTrigger
            aria-busy={catalogLoading || undefined}
            aria-label={`${ariaLabel}: ${selectedLabel}`}
            id={`${controlId}-button`}
            ref={buttonRef}
            role="button"
            size={size}
          >
            <span className="app-select__value min-w-0 wrap-anywhere whitespace-normal">
              {selectedLabel}
            </span>
          </ComboboxTrigger>
        </Tooltip>
        {isOpen ? (
          <ComboboxContent
            container={rootRef}
            initialFocus={inputRef}
            finalFocus={false}
            data-keyboard-navigation={keyboardActive || undefined}
          >
            <ComboboxInput
              aria-label={`Search fonts for ${ariaLabel}`}
              autoComplete="off"
              placeholder="Search fonts…"
              ref={inputRef}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229 ||
                  event.key === "Home" ||
                  event.key === "End"
                ) {
                  event.preventBaseUIHandler();
                  return;
                }
                if (event.key !== "Enter") return;
                const list = listRef.current;
                const active = event.currentTarget.ownerDocument.getElementById(
                  event.currentTarget.getAttribute("aria-activedescendant") ?? "",
                );
                if (
                  active &&
                  list?.contains(active) &&
                  active.getAttribute("aria-disabled") !== "true"
                )
                  return;
                // The filtered list may have just registered its rows. Commit
                // through the primitive rather than closing with no selection.
                event.preventBaseUIHandler();
                event.preventDefault();
                list
                  ?.querySelector<HTMLElement>('[role="option"]:not([aria-disabled="true"])')
                  ?.click();
              }}
              spellCheck={false}
              type="search"
            />
            <ComboboxList
              aria-label={ariaLabel}
              ref={listRef}
              className="font-picker__list min-h-0 px-font-picker-inset pb-font-picker-inset overflow-x-hidden overflow-y-auto overscroll-contain"
            >
              {visibleRows.map((row, index) => (
                <ComboboxItem disabled={row.disabled} index={index} key={row.key} value={row}>
                  {row.label}
                </ComboboxItem>
              ))}
            </ComboboxList>
            <ComboboxEmpty
              className={visibleRows.length ? "sr-only" : "px-3 py-2 text-muted text-meta"}
              role="status"
            >
              {catalogLoading ? "Loading fonts…" : "No fonts found."}
            </ComboboxEmpty>
          </ComboboxContent>
        ) : null}
      </Combobox>
    </div>
  );
}
