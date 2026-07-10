import {
  ArrowRight,
  ArrowsClockwise,
  CheckSquare,
  DotsThree,
  FolderOpen,
  Heart,
  ImageBroken,
  Trash,
} from "@phosphor-icons/react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";

type LibrarySelectionBarProps = {
  onClear: () => void;
  onDeselectVisible: () => void;
  onExit: () => void;
  onAction: (
    action: "favorite" | "unfavorite" | "move" | "delete" | "metadata" | "covers" | "export",
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

  function runOverflowAction(action: "unfavorite" | "delete" | "metadata" | "covers" | "export") {
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
            variant="secondary"
          >
            {allVisibleSelected ? "Deselect all" : "Select all"}
          </Button>
          <IconButton
            className="library-selection-bar__icon-action"
            disabled={selectedCount === 0 || busy}
            label="Add selected books to favorites"
            onClick={() => onAction("favorite")}
          >
            <Heart aria-hidden="true" size={18} />
          </IconButton>
          <IconButton
            className="library-selection-bar__icon-action"
            disabled={selectedCount === 0 || busy}
            label="Move selected books"
            onClick={() => onAction("move")}
          >
            <ArrowRight aria-hidden="true" size={18} />
          </IconButton>
          <details className="library-selection-actions-menu" ref={detailsRef}>
            <summary aria-label="More bulk actions" title="More bulk actions">
              <DotsThree aria-hidden="true" size={19} weight="bold" />
            </summary>
            <div role="menu">
              <button
                disabled={busy || selectedCount === 0}
                onClick={() => runOverflowAction("unfavorite")}
                role="menuitem"
                type="button"
              >
                <Heart aria-hidden="true" size={17} />
                Remove favorites
              </button>
              <button
                disabled={busy || selectedCount === 0}
                onClick={() => runOverflowAction("metadata")}
                role="menuitem"
                type="button"
              >
                <ArrowsClockwise aria-hidden="true" size={17} />
                Re-extract metadata
              </button>
              <button
                disabled={busy || selectedCount === 0}
                onClick={() => runOverflowAction("covers")}
                role="menuitem"
                type="button"
              >
                <ImageBroken aria-hidden="true" size={17} />
                Regenerate covers
              </button>
              <button
                disabled={busy || selectedCount === 0}
                onClick={() => runOverflowAction("export")}
                role="menuitem"
                type="button"
              >
                <FolderOpen aria-hidden="true" size={17} />
                Export EPUBs
              </button>
              <button
                className="danger"
                disabled={busy || selectedCount === 0}
                onClick={() => runOverflowAction("delete")}
                role="menuitem"
                type="button"
              >
                <Trash aria-hidden="true" size={17} />
                Delete to Recycle Bin
              </button>
            </div>
          </details>
        </div>
      </div>
      <div className="library-selection-bar__actions">
        <Button disabled={selectedCount === 0 || busy} onClick={onClear} variant="secondary">
          Clear
        </Button>
        <Button disabled={busy} onClick={onExit}>
          Done
        </Button>
      </div>
    </div>
  );
}
