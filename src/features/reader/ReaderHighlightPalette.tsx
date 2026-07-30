import { NotebookPen } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Tooltip } from "../../components/Tooltip";
import { useTransientSurfaceOwnership } from "../../utils/transientSurfaceOwnership";
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
  onDismiss: (restoreFocus?: boolean) => void;
  onNote: () => void;
  selectedColor?: ReaderHighlightColor;
  viewportRect: ClientRect;
};

const PALETTE_OPTIONS: readonly HighlightPaletteChoice[] = [...READER_HIGHLIGHT_COLORS, "none"];

function paletteChoiceLabel(
  choice: HighlightPaletteChoice,
  hasAttachedNote: boolean,
  existingHighlight: boolean,
): string {
  if (choice !== "none") return `${choice} highlight`;
  if (hasAttachedNote) return "No color — remove highlight and attached note";
  if (existingHighlight) return "No color — remove highlight";
  return "No color";
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

    useTransientSurfaceOwnership({
      closeOnModalOpen: true,
      dismissOnOutsidePointer: true,
      elementRef,
      kind: "popover",
      onDismiss: (reason) => onDismiss(reason === "escape"),
    });

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
    const existingHighlight = selectedColor !== undefined;

    function moveMenuFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
      if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"].includes(event.key)) {
        return false;
      }
      const items = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"], [role="menuitemradio"]',
        ),
      ).filter((item) => !item.disabled);
      if (items.length === 0) return false;
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowRight" || event.key === "ArrowDown"
              ? (Math.max(currentIndex, -1) + 1) % items.length
              : (currentIndex <= 0 ? items.length : currentIndex) - 1;
      event.preventDefault();
      event.stopPropagation();
      items[nextIndex]?.focus();
      return true;
    }

    return (
      <div
        ref={assignRef}
        aria-busy={busy || undefined}
        aria-label="Highlight color"
        className="reader-highlight-menu menu-popover"
        data-placement={position.placement}
        data-reader-ignore-shortcuts
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          moveMenuFocus(event);
        }}
        role="menu"
        style={{ left: position.left, top: position.top }}
      >
        {PALETTE_OPTIONS.map((choice) => {
          const choiceLabel = paletteChoiceLabel(choice, hasAttachedNote, existingHighlight);
          return (
            <Tooltip content={choiceLabel} key={choice}>
              <button
                aria-checked={choice === selectedColor}
                aria-label={choiceLabel}
                className={`reader-highlight-menu__color${
                  choice === "none" ? " reader-highlight-menu__color--none" : ""
                }`}
                data-color={choice}
                disabled={busy}
                onClick={() => onChoose(choice)}
                role="menuitemradio"
                type="button"
              />
            </Tooltip>
          );
        })}
        <span aria-hidden="true" className="reader-highlight-menu__divider" />
        <Tooltip content={noteActionLabel}>
          <button
            aria-label={noteActionLabel}
            className="reader-highlight-menu__note"
            disabled={busy}
            onClick={onNote}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true" className="icon-slot">
              <NotebookPen />
            </span>
          </button>
        </Tooltip>
      </div>
    );
  },
);
