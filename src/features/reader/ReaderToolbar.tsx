import {
  ArrowLeft,
  BookmarkSimple,
  BookmarksSimple,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  ListBullets,
  TextAa,
} from "@phosphor-icons/react";
import type { Ref } from "react";

import { IconButton } from "../../components/IconButton";
import type { ReaderMode } from "../../types/reader";

type ReaderToolbarProps = {
  atEnd: boolean;
  atStart: boolean;
  chapterProgress?: number;
  chapterTitle?: string;
  hasChapterNavigation: boolean;
  bookmarkActive: boolean;
  bookmarkBusy: boolean;
  bookmarkToggleDisabled: boolean;
  bookmarkToggleDisabledReason?: string;
  bookmarksOpen: boolean;
  nextChapterDisabled: boolean;
  backLabel: string;
  onBack: () => void;
  onBookmarks: () => void;
  onToggleBookmark: () => void;
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
  mode: ReaderMode;
  settingsButtonRef?: Ref<HTMLButtonElement>;
  tocButtonRef?: Ref<HTMLButtonElement>;
  tocOpen: boolean;
  bookmarkButtonRef?: Ref<HTMLButtonElement>;
};

export function ReaderToolbar({
  atEnd,
  atStart,
  chapterProgress,
  chapterTitle,
  hasChapterNavigation,
  bookmarkActive,
  bookmarkBusy,
  bookmarkToggleDisabled,
  bookmarkToggleDisabledReason,
  bookmarksOpen,
  nextChapterDisabled,
  backLabel,
  onBack,
  onBookmarks,
  onToggleBookmark,
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
  mode,
  settingsButtonRef,
  tocButtonRef,
  tocOpen,
  bookmarkButtonRef,
}: ReaderToolbarProps) {
  const positionLabel =
    chapterProgress === undefined
      ? `Book ${percentage.toFixed(1)}%`
      : `Chapter ${chapterProgress}% · Book ${percentage.toFixed(1)}%`;
  const statusLabel = progressSaveFailed ? `Not saved · ${positionLabel}` : positionLabel;

  return (
    <header className="reader-toolbar">
      <button
        aria-label={backLabel}
        className="reader-toolbar__back"
        onClick={onBack}
        title={backLabel}
        type="button"
      >
        <span aria-hidden="true" className="icon-slot">
          <ArrowLeft weight="regular" />
        </span>
        <span>Back</span>
      </button>
      <div className="reader-toolbar__chapter-navigation">
        {hasChapterNavigation ? (
          <IconButton
            disabled={previousChapterDisabled}
            disabledReason="You are at the first chapter"
            label="Previous chapter"
            onClick={onPreviousChapter}
            size="compact"
          >
            <CaretDoubleLeft aria-hidden="true" weight="bold" />
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
          <IconButton
            disabled={nextChapterDisabled}
            disabledReason="You are at the final chapter"
            label="Next chapter"
            onClick={onNextChapter}
            size="compact"
          >
            <CaretDoubleRight aria-hidden="true" weight="bold" />
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
          size="compact"
        >
          <ListBullets aria-hidden="true" weight="regular" />
        </IconButton>
        <IconButton
          aria-controls="reader-bookmarks"
          aria-expanded={bookmarksOpen}
          label="Bookmarks"
          onClick={onBookmarks}
          ref={bookmarkButtonRef}
          size="compact"
        >
          <BookmarksSimple aria-hidden="true" weight="regular" />
        </IconButton>
        <IconButton
          aria-pressed={bookmarkActive}
          aria-busy={bookmarkBusy || undefined}
          disabled={bookmarkToggleDisabled}
          disabledReason={bookmarkToggleDisabledReason}
          label={bookmarkActive ? "Remove bookmark" : "Add bookmark"}
          onClick={onToggleBookmark}
          size="compact"
        >
          <BookmarkSimple aria-hidden="true" weight={bookmarkActive ? "fill" : "regular"} />
        </IconButton>
        <span className="reader-toolbar__divider" />
        <IconButton
          label={mode === "continuous" ? "Scroll up" : "Previous page"}
          disabled={atStart}
          disabledReason={
            mode === "continuous" ? "You are at the top" : "You are on the first page"
          }
          onClick={onPrevious}
          size="compact"
        >
          <CaretLeft aria-hidden="true" weight="bold" />
        </IconButton>
        <IconButton
          label={mode === "continuous" ? "Scroll down" : "Next page"}
          disabled={atEnd}
          disabledReason={
            mode === "continuous" ? "You are at the end" : "You are on the final page"
          }
          onClick={onNext}
          size="compact"
        >
          <CaretRight aria-hidden="true" weight="bold" />
        </IconButton>
        <span className="reader-toolbar__divider" />
        <IconButton
          label="Reader settings"
          onClick={onSettings}
          ref={settingsButtonRef}
          size="compact"
        >
          <TextAa aria-hidden="true" weight="regular" />
        </IconButton>
      </div>
    </header>
  );
}
