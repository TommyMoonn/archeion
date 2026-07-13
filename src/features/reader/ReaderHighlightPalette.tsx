import { NotePencil } from "@phosphor-icons/react";
import { forwardRef } from "react";

import { READER_HIGHLIGHT_COLORS, type ReaderHighlightColor } from "./readerHighlights";

export type HighlightPaletteChoice = ReaderHighlightColor | "none";

type ReaderHighlightPaletteProps = {
  busy: boolean;
  onChoose: (choice: HighlightPaletteChoice) => void;
  onDismiss: () => void;
  onNote: () => void;
  selectedColor?: ReaderHighlightColor;
  x: number;
  y: number;
};

const PALETTE_OPTIONS: readonly HighlightPaletteChoice[] = [...READER_HIGHLIGHT_COLORS, "none"];

export const ReaderHighlightPalette = forwardRef<HTMLDivElement, ReaderHighlightPaletteProps>(
  function ReaderHighlightPalette({ busy, onChoose, onDismiss, onNote, selectedColor, x, y }, ref) {
    const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
    const clampedX = Math.max(100, Math.min(viewportWidth - 100, x));
    const placeBelow = y < 64;

    return (
      <div
        ref={ref}
        aria-label="Highlight color"
        className="reader-highlight-menu menu-popover"
        data-placement={placeBelow ? "below" : "above"}
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
        style={{ left: clampedX, top: placeBelow ? y + 10 : y }}
      >
        {PALETTE_OPTIONS.map((choice) => (
          <button
            aria-checked={choice === selectedColor}
            aria-label={choice === "none" ? "No color" : `${choice} highlight`}
            className={`reader-highlight-menu__color${
              choice === "none" ? " reader-highlight-menu__color--none" : ""
            }`}
            data-color={choice}
            disabled={busy}
            key={choice}
            onClick={() => onChoose(choice)}
            role="menuitemradio"
            type="button"
          />
        ))}
        <span aria-hidden="true" className="reader-highlight-menu__divider" />
        <button
          aria-label="Add or edit note"
          className="reader-highlight-menu__note"
          disabled={busy}
          onClick={onNote}
          role="menuitem"
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
