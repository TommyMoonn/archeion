import {
  ArrowLeft,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  ListBullets,
  TextAa,
} from "@phosphor-icons/react";
import type { Ref } from "react";
import { Link } from "react-router-dom";

import { IconButton } from "../../components/IconButton";

type ReaderToolbarProps = {
  atEnd: boolean;
  atStart: boolean;
  chapterProgress?: number;
  chapterTitle?: string;
  hasChapterNavigation: boolean;
  nextChapterDisabled: boolean;
  onNext: () => void;
  onNextChapter: () => void;
  onPrevious: () => void;
  onPreviousChapter: () => void;
  onSettings: () => void;
  onToc: () => void;
  percentage: number;
  previousChapterDisabled: boolean;
  progressSaveFailed: boolean;
  title: string;
  tocButtonRef?: Ref<HTMLButtonElement>;
  tocOpen: boolean;
};

export function ReaderToolbar({
  atEnd,
  atStart,
  chapterProgress,
  chapterTitle,
  hasChapterNavigation,
  nextChapterDisabled,
  onNext,
  onNextChapter,
  onPrevious,
  onPreviousChapter,
  onSettings,
  onToc,
  percentage,
  previousChapterDisabled,
  progressSaveFailed,
  title,
  tocButtonRef,
  tocOpen,
}: ReaderToolbarProps) {
  const positionLabel =
    chapterProgress === undefined
      ? `Book ${percentage.toFixed(1)}%`
      : `Chapter ${chapterProgress}% · Book ${percentage.toFixed(1)}%`;
  const statusLabel = progressSaveFailed ? `Not saved · ${positionLabel}` : positionLabel;

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
      <div className="reader-toolbar__chapter-navigation">
        {hasChapterNavigation ? (
          <IconButton
            disabled={previousChapterDisabled}
            label="Previous chapter"
            onClick={onPreviousChapter}
          >
            <CaretDoubleLeft aria-hidden="true" size={18} weight="bold" />
          </IconButton>
        ) : (
          <span aria-hidden="true" className="reader-toolbar__chapter-spacer" />
        )}
        <div className="reader-toolbar__identity">
          <p aria-live="polite" title={chapterTitle ?? title}>
            {chapterTitle ?? title}
          </p>
          <span data-error={progressSaveFailed || undefined} title={statusLabel}>
            {statusLabel}
          </span>
        </div>
        {hasChapterNavigation ? (
          <IconButton disabled={nextChapterDisabled} label="Next chapter" onClick={onNextChapter}>
            <CaretDoubleRight aria-hidden="true" size={18} weight="bold" />
          </IconButton>
        ) : (
          <span aria-hidden="true" className="reader-toolbar__chapter-spacer" />
        )}
      </div>
      <div className="reader-toolbar__navigation">
        <IconButton
          aria-controls="reader-table-of-contents"
          aria-expanded={tocOpen}
          label="Table of contents"
          onClick={onToc}
          ref={tocButtonRef}
        >
          <ListBullets aria-hidden="true" size={19} weight="regular" />
        </IconButton>
        <span className="reader-toolbar__divider" />
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
