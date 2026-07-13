import { NotePencil } from "@phosphor-icons/react";
import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from "react";

import { READER_HIGHLIGHT_COLORS, type ReaderHighlightColor } from "./readerHighlights";
import {
  normalizeClientRect,
  placeHighlightPalette,
  type ClientRect,
} from "./readerHighlightPaletteAnchor";

export type HighlightPaletteChoice = ReaderHighlightColor | "none";

type ReaderHighlightPaletteProps = {
  anchorRect: ClientRect;
  busy: boolean;
  hasAttachedNote?: boolean;
  noteActionLabel: "Add note" | "Edit note" | "Highlight and add note";
  onChoose: (choice: HighlightPaletteChoice) => void;
  onDismiss: () => void;
  onNote: () => void;
  selectedColor?: ReaderHighlightColor;
  viewportRect: ClientRect;
};

const PALETTE_OPTIONS: readonly HighlightPaletteChoice[] = [...READER_HIGHLIGHT_COLORS, "none"];

function paletteChoiceLabel(choice: HighlightPaletteChoice, hasAttachedNote: boolean): string {
  if (choice !== "none") return `${choice} highlight`;
  return hasAttachedNote ? "No color — remove highlight and attached note" : "No color";
}

export const ReaderHighlightPalette = forwardRef<HTMLDivElement, ReaderHighlightPaletteProps>(
  function ReaderHighlightPalette(
    {
      anchorRect,
      busy,
      hasAttachedNote = false,
      noteActionLabel,
      onChoose,
      onDismiss,
      onNote,
      selectedColor,
      viewportRect,
    },
    forwardedRef,
  ) {
    const elementRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState({ height: 0, width: 0 });
    const assignRef = useCallback(
      (node: HTMLDivElement | null) => {
        elementRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    useLayoutEffect(() => {
      const element = elementRef.current;
      if (!element) return;
      const measure = () => {
        const bounds = normalizeClientRect(element.getBoundingClientRect());
        if (bounds) setSize({ height: bounds.height, width: bounds.width });
      };
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    const position = placeHighlightPalette(anchorRect, viewportRect, size);
    if (!position) return null;

    return (
      <div
        ref={assignRef}
        aria-label="Highlight color"
        className="reader-highlight-menu menu-popover"
        data-placement={position.placement}
        data-reader-ignore-shortcuts
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDismiss();
          }
        }}
        role="menu"
        style={{ left: position.left, top: position.top }}
      >
        {PALETTE_OPTIONS.map((choice) => (
          <button
            aria-checked={choice === selectedColor}
            aria-label={paletteChoiceLabel(choice, hasAttachedNote)}
            className={`reader-highlight-menu__color${
              choice === "none" ? " reader-highlight-menu__color--none" : ""
            }`}
            data-color={choice}
            disabled={busy}
            key={choice}
            onClick={() => onChoose(choice)}
            role="menuitemradio"
            title={paletteChoiceLabel(choice, hasAttachedNote)}
            type="button"
          />
        ))}
        <span aria-hidden="true" className="reader-highlight-menu__divider" />
        <button
          aria-label={noteActionLabel}
          className="reader-highlight-menu__note"
          disabled={busy}
          onClick={onNote}
          role="menuitem"
          title={noteActionLabel}
          type="button"
        >
          <span aria-hidden="true" className="icon-slot">
            <NotePencil />
          </span>
        </button>
      </div>
    );
  },
);
