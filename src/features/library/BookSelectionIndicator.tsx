import { Check } from "lucide-react";

import { cn } from "../../utils/cn";

/** The owning book button exposes the selection state; this marker is decorative. */
export function BookSelectionIndicator({
  selected,
  placement,
}: {
  selected: boolean;
  placement: "card" | "row";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "book-selection-control absolute z-4 grid size-book-selection-control place-items-center p-0 border border-solid border-line-strong rounded-control text-canvas-deep bg-surface-raised pointer-events-none data-[selected=true]:border-accent data-[selected=true]:bg-accent",
        placement === "card"
          ? "book-selection-control--card top-book-menu-card-inset left-book-menu-card-inset"
          : "book-selection-control--row top-1/2 end-field-inline -translate-y-1/2",
      )}
      data-selected={selected || undefined}
    >
      {selected ? (
        <Check
          aria-hidden="true"
          className={placement === "card" ? "size-book-selection-glyph" : "size-icon-glyph-compact"}
          strokeWidth={2.25}
        />
      ) : null}
    </span>
  );
}
