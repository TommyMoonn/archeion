import {
  ArrowSquareOut,
  Check,
  Copy,
  Highlighter,
  MagnifyingGlass,
  NotePencil,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import { MenuItem } from "../../components/MenuItem";
import { useTransientSurfaceOwnership } from "../../utils/transientSurfaceOwnership";
import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import {
  READER_HIGHLIGHT_COLORS,
  normalizeReaderHighlightColor,
  type ReaderHighlightColor,
} from "./readerHighlights";
import { readerAnnotationRemoveLabel } from "./readerAnnotations";
import type { ReaderAnnotationMenuState } from "./useReaderAnnotationActionMenu";

const HIGHLIGHT_COLOR_LABELS: Record<ReaderHighlightColor, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  rose: "Rose",
};

type ReaderAnnotationActionMenuProps = {
  busyAnnotationId?: string;
  menu?: ReaderAnnotationMenuState;
  menuRef: RefObject<HTMLDivElement | null>;
  onBeginBookmarkRename: (annotation: BookmarkAnnotation) => void;
  onBeginRemoval: (annotation: Annotation) => void;
  onClose: (options?: { restoreFocus?: boolean }) => void;
  onCopyDetached: (annotation: Annotation) => void;
  onEditNote: (annotation: HighlightAnnotation) => void;
  onEscape: () => void;
  onNavigate: (annotation: Annotation) => void;
  onOpenColors: () => void;
  onRecolor: (annotation: HighlightAnnotation, color: ReaderHighlightColor) => Promise<boolean>;
  onRecover: (annotation: Annotation) => void;
};

export function ReaderAnnotationActionMenu({
  busyAnnotationId,
  menu,
  menuRef,
  onBeginBookmarkRename,
  onBeginRemoval,
  onClose,
  onCopyDetached,
  onEditNote,
  onEscape,
  onNavigate,
  onOpenColors,
  onRecolor,
  onRecover,
}: ReaderAnnotationActionMenuProps) {
  useTransientSurfaceOwnership({
    active: Boolean(menu),
    closeOnModalOpen: true,
    dismissOnOutsidePointer: true,
    elementRef: menuRef,
    kind: "popover",
    onDismiss: (reason) => {
      if (reason === "escape") {
        onEscape();
      } else if (reason === "outside-pointer") {
        onClose({ restoreFocus: true });
      } else {
        onClose();
      }
    },
    trigger: menu?.trigger,
  });

  if (!menu) return null;

  function runFromTrigger(action: (annotation: Annotation) => void) {
    onClose({ restoreFocus: true });
    action(menu!.annotation);
  }

  function beginInlineAction(action: (annotation: Annotation) => void) {
    onClose();
    action(menu!.annotation);
  }

  return (
    <div
      className="menu-popover reader-annotations__menu-popover"
      data-placement={menu.placement}
      onKeyDown={(event) => {
        moveMenuItemFocus(event);
      }}
      ref={menuRef}
      role="menu"
      style={
        {
          "--annotation-menu-right": `${menu.right}px`,
          "--annotation-menu-top": `${menu.top}px`,
        } as CSSProperties
      }
    >
      {menu.mode === "colors" && menu.annotation.type === "highlight" ? (
        <div aria-label="Highlight color" role="group">
          {READER_HIGHLIGHT_COLORS.map((color) => {
            const selected = normalizeReaderHighlightColor(menu.annotation.color) === color;
            return (
              <button
                aria-checked={selected}
                className="menu-item reader-annotations__color-option"
                data-color={color}
                disabled={busyAnnotationId === menu.annotation.id}
                key={color}
                onClick={() => {
                  if (menu.annotation.type !== "highlight") return;
                  void onRecolor(menu.annotation, color).then((recolored) => {
                    if (recolored) onClose({ restoreFocus: true });
                  });
                }}
                role="menuitemradio"
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="reader-annotations__color reader-annotations__color-choice"
                  data-color={color}
                />
                <span className="menu-item__label">{HIGHLIGHT_COLOR_LABELS[color]}</span>
                {selected ? (
                  <span aria-hidden="true" className="icon-slot icon-slot--compact">
                    <Check />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <MenuItem
            disabled={
              menu.annotation.anchorStatus === "detached" || !menu.annotation.cfiRange?.trim()
            }
            icon={<ArrowSquareOut weight="regular" />}
            onClick={() => runFromTrigger(onNavigate)}
          >
            Go to location
          </MenuItem>
          {menu.annotation.anchorStatus === "detached" ? (
            <>
              <MenuItem
                icon={<MagnifyingGlass weight="regular" />}
                onClick={() => runFromTrigger(onRecover)}
              >
                Attempt to locate
              </MenuItem>
              <MenuItem
                icon={<Copy weight="regular" />}
                onClick={() => runFromTrigger(onCopyDetached)}
              >
                Copy annotation
              </MenuItem>
            </>
          ) : null}
          {menu.annotation.type === "highlight" ? (
            <>
              <MenuItem
                data-recolor-highlight
                icon={<Highlighter weight="regular" />}
                onClick={onOpenColors}
              >
                Recolor highlight
              </MenuItem>
              <MenuItem
                icon={<NotePencil weight="regular" />}
                onClick={() =>
                  runFromTrigger((annotation) => {
                    if (annotation.type === "highlight") onEditNote(annotation);
                  })
                }
              >
                {menu.annotation.note?.trim() ? "Edit note" : "Add note"}
              </MenuItem>
            </>
          ) : null}
          {menu.annotation.type === "bookmark" ? (
            <MenuItem
              icon={<PencilSimple weight="regular" />}
              onClick={() =>
                beginInlineAction((annotation) => {
                  if (annotation.type === "bookmark") onBeginBookmarkRename(annotation);
                })
              }
            >
              Rename bookmark
            </MenuItem>
          ) : null}
          <MenuItem
            danger
            icon={<Trash weight="regular" />}
            onClick={() => beginInlineAction(onBeginRemoval)}
          >
            {readerAnnotationRemoveLabel(menu.annotation)}
          </MenuItem>
        </>
      )}
    </div>
  );
}

function moveMenuItemFocus(event: ReactKeyboardEvent<HTMLElement>): boolean {
  if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"].includes(event.key)) {
    return false;
  }
  const menu = event.currentTarget.closest<HTMLElement>('[role="menu"]') ?? event.currentTarget;
  const items = Array.from(
    menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]'),
  ).filter((item) => !item.disabled);
  if (items.length === 0) return false;
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown" || event.key === "ArrowRight"
          ? (Math.max(currentIndex, -1) + 1) % items.length
          : (currentIndex <= 0 ? items.length : currentIndex) - 1;
  event.preventDefault();
  event.stopPropagation();
  items[nextIndex]?.focus();
  return true;
}
