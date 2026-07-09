import { ArrowLeft, CaretLeft, CaretRight, TextAa } from "@phosphor-icons/react";
import { Link } from "react-router-dom";

import { IconButton } from "../../components/IconButton";

type ReaderToolbarProps = {
  atEnd: boolean;
  atStart: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onSettings: () => void;
  percentage: number;
  progressSaveFailed: boolean;
  title: string;
};

export function ReaderToolbar({
  atEnd,
  atStart,
  onNext,
  onPrevious,
  onSettings,
  percentage,
  progressSaveFailed,
  title,
}: ReaderToolbarProps) {
  return (
    <header className="reader-toolbar">
      <Link
        aria-label="Return to library"
        className="reader-toolbar__back"
        title="Return to library"
        to="/"
      >
        <ArrowLeft aria-hidden="true" size={18} weight="regular" />
        <span>Library</span>
      </Link>
      <div className="reader-toolbar__identity">
        <p>{title}</p>
        <span data-error={progressSaveFailed || undefined}>
          {progressSaveFailed ? "Progress not saved" : `${percentage.toFixed(1)}%`}
        </span>
      </div>
      <div className="reader-toolbar__navigation">
        <IconButton label="Previous page" disabled={atStart} onClick={onPrevious}>
          <CaretLeft aria-hidden="true" size={19} weight="bold" />
        </IconButton>
        <IconButton label="Next page" disabled={atEnd} onClick={onNext}>
          <CaretRight aria-hidden="true" size={19} weight="bold" />
        </IconButton>
        <span className="reader-toolbar__divider" />
        <IconButton label="Reader settings" onClick={onSettings}>
          <TextAa aria-hidden="true" size={19} weight="regular" />
        </IconButton>
      </div>
    </header>
  );
}
