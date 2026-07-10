import { CheckSquare } from "@phosphor-icons/react";

import { Button } from "../../components/Button";

type LibrarySelectionBarProps = {
  onClear: () => void;
  onDeselectVisible: () => void;
  onExit: () => void;
  onSelectVisible: () => void;
  selectedCount: number;
  visibleCount: number;
  visibleSelectedCount: number;
};

export function LibrarySelectionBar({
  onClear,
  onDeselectVisible,
  onExit,
  onSelectVisible,
  selectedCount,
  visibleCount,
  visibleSelectedCount,
}: LibrarySelectionBarProps) {
  const hiddenSelectedCount = selectedCount - visibleSelectedCount;
  const allVisibleSelected = visibleCount > 0 && visibleSelectedCount === visibleCount;

  return (
    <div className="library-selection-bar" role="toolbar" aria-label="Book selection actions">
      <div className="library-selection-bar__status" aria-live="polite">
        <CheckSquare aria-hidden="true" size={15} weight={selectedCount ? "fill" : "regular"} />
        <strong>{selectedCount} selected</strong>
        <span className="sr-only">
          {hiddenSelectedCount > 0
            ? `${hiddenSelectedCount} selected outside this view.`
            : `${visibleSelectedCount} selected in this view.`}
        </span>
      </div>
      <div className="library-selection-bar__actions">
        <Button
          disabled={visibleCount === 0}
          onClick={allVisibleSelected ? onDeselectVisible : onSelectVisible}
          variant="secondary"
        >
          {allVisibleSelected ? "Deselect visible" : "Select all visible"}
        </Button>
        <Button disabled={selectedCount === 0} onClick={onClear} variant="secondary">
          Clear
        </Button>
        <Button onClick={onExit}>Done</Button>
      </div>
    </div>
  );
}
