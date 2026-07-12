import {
  ArrowRight,
  ArrowsClockwise,
  CheckSquare,
  DotsThree,
  FolderOpen,
  Heart,
  ImageBroken,
  NotePencil,
  Trash,
} from "@phosphor-icons/react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { MenuItem } from "../../components/MenuItem";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";

type LibrarySelectionBarProps = {
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
      | "export",
  ) => void;
  onSelectVisible: () => void;
  selectedCount: number;
  visibleCount: number;
  visibleSelectedCount: number;
  busy?: boolean;
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
}: LibrarySelectionBarProps) {
  const { closeDetails, detailsRef } = useDismissibleDetails();
  const hiddenSelectedCount = selectedCount - visibleSelectedCount;
  const allVisibleSelected = visibleCount > 0 && visibleSelectedCount === visibleCount;

  function runOverflowAction(
    action: "unfavorite" | "delete" | "edit-metadata" | "metadata" | "covers" | "export",
  ) {
    closeDetails();
    onAction(action);
  }

  return (
    <div className="library-selection-bar" role="toolbar" aria-label="Book selection actions">
      <div className="library-selection-bar__primary">
        <div className="library-selection-bar__status" aria-live="polite">
          <CheckSquare aria-hidden="true" size={15} weight={selectedCount ? "fill" : "regular"} />
          <strong>{selectedCount} selected</strong>
          <span className="sr-only">
            {hiddenSelectedCount > 0
              ? `${hiddenSelectedCount} selected outside this view.`
              : `${visibleSelectedCount} selected in this view.`}
          </span>
        </div>
        <div className="library-selection-bar__bulk-actions">
          <Button
            disabled={visibleCount === 0 || busy}
            onClick={allVisibleSelected ? onDeselectVisible : onSelectVisible}
            size="compact"
            variant="secondary"
          >
            {allVisibleSelected ? "Deselect all" : "Select all"}
          </Button>
          <IconButton
            className="library-selection-bar__icon-action"
            disabled={selectedCount === 0 || busy}
            disabledReason={busy ? "Wait for the current action to finish" : "Select a book first"}
            label="Add selected books to favorites"
            onClick={() => onAction("favorite")}
          >
            <Heart aria-hidden="true" size={18} />
          </IconButton>
          <IconButton
            className="library-selection-bar__icon-action"
            disabled={selectedCount === 0 || busy}
            disabledReason={busy ? "Wait for the current action to finish" : "Select a book first"}
            label="Move selected books"
            onClick={() => onAction("move")}
          >
            <ArrowRight aria-hidden="true" size={18} />
          </IconButton>
          <details className="library-selection-actions-menu" ref={detailsRef}>
            <summary
              className="menu-trigger"
              aria-label="More bulk actions"
              title="More bulk actions"
            >
              <span aria-hidden="true" className="icon-slot">
                <DotsThree weight="bold" />
              </span>
            </summary>
            <div className="menu-popover" role="menu">
              <MenuItem
                disabled={busy || selectedCount === 0}
                icon={<NotePencil />}
                onClick={() => runOverflowAction("edit-metadata")}
              >
                Edit metadata
              </MenuItem>
              <MenuItem
                disabled={busy || selectedCount === 0}
                icon={<Heart />}
                onClick={() => runOverflowAction("unfavorite")}
              >
                Remove favorites
              </MenuItem>
              <MenuItem
                disabled={busy || selectedCount === 0}
                icon={<ArrowsClockwise />}
                onClick={() => runOverflowAction("metadata")}
              >
                Re-extract metadata
              </MenuItem>
              <MenuItem
                disabled={busy || selectedCount === 0}
                icon={<ImageBroken />}
                onClick={() => runOverflowAction("covers")}
              >
                Regenerate covers
              </MenuItem>
              <MenuItem
                disabled={busy || selectedCount === 0}
                icon={<FolderOpen />}
                onClick={() => runOverflowAction("export")}
              >
                Export EPUBs
              </MenuItem>
              <MenuItem
                className="danger"
                danger
                disabled={busy || selectedCount === 0}
                icon={<Trash />}
                onClick={() => runOverflowAction("delete")}
              >
                Delete to Recycle Bin
              </MenuItem>
            </div>
          </details>
        </div>
      </div>
      <div className="library-selection-bar__actions">
        <Button
          disabled={selectedCount === 0 || busy}
          onClick={onClear}
          size="compact"
          variant="secondary"
        >
          Clear
        </Button>
        <Button disabled={busy} onClick={onExit} size="compact">
          Done
        </Button>
      </div>
    </div>
  );
}
