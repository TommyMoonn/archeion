import { useCallback, useLayoutEffect, useRef, useState, type Ref } from "react";
import { flushSync } from "react-dom";

import {
  ArrowRight,
  RefreshCw,
  SquareCheckBig,
  Ellipsis,
  Download,
  FolderOpen,
  Heart,
  ImageOff,
  NotebookPen,
  Trash2,
} from "lucide-react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { PrimitiveMenuItem } from "../../components/MenuItem";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Tooltip } from "../../components/Tooltip";
import { focusElementIfUsable } from "../../utils/focusRestoration";
import { registerTransientSurface } from "../../utils/transientSurfaceOwnership";

export type LibrarySelectionBarProps = {
  onClear: () => void;
  onDeselectVisible: () => void;
  onExit: () => void;
  onAction: (
    action:
      | "favorite"
      | "unfavorite"
      | "move"
      | "delete"
      | "edit-metadata"
      | "metadata"
      | "covers"
      | "annotations-markdown"
      | "annotations-json"
      | "export",
  ) => void;
  onSelectVisible: () => void;
  selectedCount: number;
  visibleCount: number;
  visibleSelectedCount: number;
  busy?: boolean;
  exitButtonRef?: Ref<HTMLButtonElement>;
};

export function LibrarySelectionBar({
  onClear,
  onDeselectVisible,
  onExit,
  onAction,
  onSelectVisible,
  selectedCount,
  visibleCount,
  visibleSelectedCount,
  busy = false,
  exitButtonRef,
}: LibrarySelectionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [popup, setPopup] = useState<HTMLElement | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback((restoreFocus = false) => {
    if (restoreFocus) {
      flushSync(() => setMenuOpen(false));
      focusElementIfUsable(triggerRef.current);
    } else {
      setMenuOpen(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen || !popup) return;
    return registerTransientSurface({
      element: popup,
      trigger: triggerRef.current,
      kind: "popover",
      closeOnModalOpen: true,
      dismissOnOutsidePointer: true,
      onDismiss: (reason) => closeMenu(reason === "escape"),
    });
  }, [menuOpen, popup, closeMenu]);
  const hiddenSelectedCount = selectedCount - visibleSelectedCount;
  const allVisibleSelected = visibleCount > 0 && visibleSelectedCount === visibleCount;

  function runOverflowAction(
    action:
      | "unfavorite"
      | "delete"
      | "edit-metadata"
      | "metadata"
      | "covers"
      | "annotations-markdown"
      | "annotations-json"
      | "export",
  ) {
    // Dialogs capture the current focus origin; restore the durable trigger first.
    closeMenu(true);
    onAction(action);
  }

  return (
    <div
      className="library-selection-bar flex items-center justify-between gap-[18px] w-full max-w-collection-workspace min-h-[52px] py-[8px] ps-[14px] pe-[10px] m-0 border-standard border-solid border-line rounded-menu bg-surface page-mobile:items-stretch page-mobile:flex-col page-mobile:gap-[4px] page-mobile:p-[10px]"
      role="group"
      aria-label="Book selection actions"
    >
      <div className="library-selection-bar__primary flex items-center min-w-0 gap-[14px] page-mobile:justify-between page-mobile:w-full">
        <div
          className="library-selection-bar__status flex items-center min-w-0 gap-[8px] page-mobile:min-h-[30px] page-mobile:px-[6px]"
          aria-live="polite"
        >
          <SquareCheckBig
            aria-hidden="true"
            className="library-selection-bar__status-icon flex-none text-text-strong"
            size={20}
            strokeWidth={2.25}
          />
          <strong className="text-text-strong [font-size:var(--type-body)] whitespace-nowrap">
            {selectedCount} selected
          </strong>
          <span className="sr-only">
            {hiddenSelectedCount > 0
              ? `${hiddenSelectedCount} selected outside this view.`
              : `${visibleSelectedCount} selected in this view.`}
          </span>
        </div>
        <div className="library-selection-bar__bulk-actions flex items-center gap-[2px]">
          <IconButton
            className="library-selection-bar__icon-action focus-visible:text-text-strong focus-visible:bg-surface-hover"
            disabled={selectedCount === 0 || busy}
            disabledReason={busy ? "Wait for the current action to finish" : "Select a book first"}
            label="Add selected books to favorites"
            onClick={() => onAction("favorite")}
            size="compact"
            tooltip={
              busy
                ? "Wait for the current action to finish"
                : selectedCount === 0
                  ? "Select a book first"
                  : "Add selected books to favorites"
            }
          >
            <Heart aria-hidden="true" />
          </IconButton>
          <IconButton
            className="library-selection-bar__icon-action focus-visible:text-text-strong focus-visible:bg-surface-hover"
            disabled={selectedCount === 0 || busy}
            disabledReason={busy ? "Wait for the current action to finish" : "Select a book first"}
            label="Move selected books"
            onClick={() => onAction("move")}
            size="compact"
            tooltip={
              busy
                ? "Wait for the current action to finish"
                : selectedCount === 0
                  ? "Select a book first"
                  : "Move selected books"
            }
          >
            <ArrowRight aria-hidden="true" />
          </IconButton>
          <DropdownMenu
            open={menuOpen}
            modal={false}
            onOpenChange={(next, details) => {
              if (
                popup &&
                (details.reason === "outside-press" || details.reason === "escape-key")
              ) {
                details.cancel();
                return;
              }
              if (next) {
                setPortalContainer(triggerRef.current?.closest<HTMLElement>(".window-app") ?? null);
              }
              setMenuOpen(next);
            }}
          >
            <Tooltip content="More bulk actions">
              <DropdownMenuTrigger
                ref={triggerRef}
                className="library-selection-bar__icon-action inline-grid shrink-0 size-control-compact place-items-center p-0 border-standard border-solid border-transparent rounded-control text-muted bg-transparent cursor-pointer transition-select hover:text-text-strong hover:bg-surface-hover focus-visible:text-text-strong focus-visible:bg-surface-hover aria-expanded:text-text-strong aria-expanded:bg-surface-hover"
                aria-label="More bulk actions"
              >
                <span aria-hidden="true" className="icon-slot">
                  <Ellipsis />
                </span>
              </DropdownMenuTrigger>
            </Tooltip>
            {menuOpen ? (
              <DropdownMenuContent
                aria-label="More bulk actions"
                ref={setPopup}
                container={portalContainer ?? undefined}
                align="end"
                sideOffset={7}
                className="library-selection-actions-menu min-w-[min(205px,calc(100vw-var(--spacing-overlay-viewport-inset)))]"
              >
                <PrimitiveMenuItem
                  point={false}
                  disabled={busy || selectedCount === 0}
                  icon={<NotebookPen />}
                  onClick={() => runOverflowAction("edit-metadata")}
                >
                  Edit metadata
                </PrimitiveMenuItem>
                <PrimitiveMenuItem
                  point={false}
                  disabled={busy || selectedCount === 0}
                  icon={<Heart />}
                  onClick={() => runOverflowAction("unfavorite")}
                >
                  Remove favorites
                </PrimitiveMenuItem>
                <PrimitiveMenuItem
                  point={false}
                  disabled={busy || selectedCount === 0}
                  icon={<RefreshCw />}
                  onClick={() => runOverflowAction("metadata")}
                >
                  Re-extract metadata
                </PrimitiveMenuItem>
                <PrimitiveMenuItem
                  point={false}
                  disabled={busy || selectedCount === 0}
                  icon={<ImageOff />}
                  onClick={() => runOverflowAction("covers")}
                >
                  Regenerate covers
                </PrimitiveMenuItem>
                <PrimitiveMenuItem
                  point={false}
                  disabled={busy || selectedCount === 0}
                  icon={<FolderOpen />}
                  onClick={() => runOverflowAction("export")}
                >
                  Export EPUBs
                </PrimitiveMenuItem>
                <PrimitiveMenuItem
                  point={false}
                  disabled={busy || selectedCount === 0}
                  icon={<Download />}
                  onClick={() => runOverflowAction("annotations-markdown")}
                >
                  Annotations (Markdown)
                </PrimitiveMenuItem>
                <PrimitiveMenuItem
                  point={false}
                  disabled={busy || selectedCount === 0}
                  icon={<Download />}
                  onClick={() => runOverflowAction("annotations-json")}
                >
                  Annotations (JSON)
                </PrimitiveMenuItem>
                <PrimitiveMenuItem
                  point={false}
                  className="danger"
                  danger
                  disabled={busy || selectedCount === 0}
                  icon={<Trash2 />}
                  onClick={() => runOverflowAction("delete")}
                >
                  Delete to Recycle Bin
                </PrimitiveMenuItem>
              </DropdownMenuContent>
            ) : null}
          </DropdownMenu>
        </div>
      </div>
      <div className="library-selection-bar__actions flex items-center flex-none flex-wrap justify-end gap-[6px] page-mobile:self-end">
        <Button
          className="[&:not(:disabled)]:cursor-pointer"
          disabled={visibleCount === 0 || busy}
          onClick={allVisibleSelected ? onDeselectVisible : onSelectVisible}
          size="compact"
          variant="secondary"
        >
          {allVisibleSelected ? "Deselect all" : "Select all"}
        </Button>
        <Button
          className="[&:not(:disabled)]:cursor-pointer"
          disabled={selectedCount === 0 || busy}
          onClick={onClear}
          size="compact"
          variant="secondary"
        >
          Clear
        </Button>
        <Button
          className="[&:not(:disabled)]:cursor-pointer"
          disabled={busy}
          onClick={onExit}
          ref={exitButtonRef}
          size="compact"
        >
          Done
        </Button>
      </div>
    </div>
  );
}
