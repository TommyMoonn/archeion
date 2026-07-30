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
import { MenuItem } from "../../components/MenuItem";
import { Tooltip } from "../../components/Tooltip";
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
      | "annotations-markdown"
      | "annotations-json"
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
    closeDetails();
    onAction(action);
  }

  return (
    <div className="library-selection-bar" role="toolbar" aria-label="Book selection actions">
      <div className="library-selection-bar__primary">
        <div className="library-selection-bar__status" aria-live="polite">
          <SquareCheckBig
            aria-hidden="true"
            className="library-selection-bar__status-icon"
            size={20}
            strokeWidth={2.25}
          />
          <strong>{selectedCount} selected</strong>
          <span className="sr-only">
            {hiddenSelectedCount > 0
              ? `${hiddenSelectedCount} selected outside this view.`
              : `${visibleSelectedCount} selected in this view.`}
          </span>
        </div>
        <div className="library-selection-bar__bulk-actions">
          <IconButton
            className="library-selection-bar__icon-action"
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
            className="library-selection-bar__icon-action"
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
          <details className="library-selection-actions-menu" ref={detailsRef}>
            <Tooltip content="More bulk actions">
              <summary
                className="menu-trigger library-selection-bar__icon-action"
                aria-label="More bulk actions"
              >
                <span aria-hidden="true" className="icon-slot">
                  <Ellipsis strokeWidth={2.25} />
                </span>
              </summary>
            </Tooltip>
            <div className="menu-popover" role="menu">
              <MenuItem
                disabled={busy || selectedCount === 0}
                icon={<NotebookPen />}
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
                icon={<RefreshCw />}
                onClick={() => runOverflowAction("metadata")}
              >
                Re-extract metadata
              </MenuItem>
              <MenuItem
                disabled={busy || selectedCount === 0}
                icon={<ImageOff />}
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
                disabled={busy || selectedCount === 0}
                icon={<Download />}
                onClick={() => runOverflowAction("annotations-markdown")}
              >
                Annotations (Markdown)
              </MenuItem>
              <MenuItem
                disabled={busy || selectedCount === 0}
                icon={<Download />}
                onClick={() => runOverflowAction("annotations-json")}
              >
                Annotations (JSON)
              </MenuItem>
              <MenuItem
                className="danger"
                danger
                disabled={busy || selectedCount === 0}
                icon={<Trash2 />}
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
          disabled={visibleCount === 0 || busy}
          onClick={allVisibleSelected ? onDeselectVisible : onSelectVisible}
          size="compact"
          variant="secondary"
        >
          {allVisibleSelected ? "Deselect all" : "Select all"}
        </Button>
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
