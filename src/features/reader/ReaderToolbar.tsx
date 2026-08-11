import {
  ArrowLeft,
  Bookmark,
  BookMarked,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  ListTree,
  Redo2,
  Search,
  Undo2,
  ALargeSmall,
} from "lucide-react";
import type { Ref } from "react";

import { IconButton } from "../../components/IconButton";
import type { ReaderMode } from "../../types/reader";

type ReaderToolbarProps = {
  atEnd: boolean;
  atStart: boolean;
  chapterProgress?: number;
  chapterTitle?: string;
  hasChapterNavigation: boolean;
  historyBackAriaKeyShortcuts?: string;
  historyBackDisabled: boolean;
  historyForwardAriaKeyShortcuts?: string;
  historyForwardDisabled: boolean;
  bookmarkActive: boolean;
  bookmarkAriaKeyShortcuts?: string;
  bookmarkBusy: boolean;
  bookmarkToggleDisabled: boolean;
  bookmarkToggleDisabledReason?: string;
  annotationsAriaKeyShortcuts?: string;
  annotationsOpen: boolean;
  nextChapterDisabled: boolean;
  backLabel: string;
  onBack: () => void;
  onHistoryBack: () => void;
  onHistoryForward: () => void;
  onAnnotations: () => void;
  onToggleBookmark: () => void;
  onNext: () => void;
  onNextChapter: () => void;
  onPrevious: () => void;
  onPreviousChapter: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onNavigation: () => void;
  percentage: number;
  previousChapterDisabled: boolean;
  progressSaveFailed: boolean;
  title: string;
  mode: ReaderMode;
  searchAriaKeyShortcuts?: string;
  settingsAriaKeyShortcuts?: string;
  navigationAriaKeyShortcuts?: string;
  searchButtonRef?: Ref<HTMLButtonElement>;
  settingsButtonRef?: Ref<HTMLButtonElement>;
  navigationButtonRef?: Ref<HTMLButtonElement>;
  navigationOpen: boolean;
  searchOpen: boolean;
  annotationButtonRef?: Ref<HTMLButtonElement>;
};

export function ReaderToolbar({
  atEnd,
  atStart,
  chapterProgress,
  chapterTitle,
  hasChapterNavigation,
  historyBackAriaKeyShortcuts,
  historyBackDisabled,
  historyForwardAriaKeyShortcuts,
  historyForwardDisabled,
  bookmarkActive,
  bookmarkAriaKeyShortcuts,
  bookmarkBusy,
  bookmarkToggleDisabled,
  bookmarkToggleDisabledReason,
  annotationsAriaKeyShortcuts,
  annotationsOpen,
  nextChapterDisabled,
  backLabel,
  onBack,
  onHistoryBack,
  onHistoryForward,
  onAnnotations,
  onToggleBookmark,
  onNext,
  onNextChapter,
  onPrevious,
  onPreviousChapter,
  onSearch,
  onSettings,
  onNavigation,
  percentage,
  previousChapterDisabled,
  progressSaveFailed,
  title,
  mode,
  searchAriaKeyShortcuts,
  settingsAriaKeyShortcuts,
  navigationAriaKeyShortcuts,
  searchButtonRef,
  settingsButtonRef,
  navigationButtonRef,
  navigationOpen,
  searchOpen,
  annotationButtonRef,
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
        type="button"
      >
        <span aria-hidden="true" className="icon-slot">
          <ArrowLeft />
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
            tooltip={previousChapterDisabled ? "You are at the first chapter" : "Previous chapter"}
            tooltipPlacement="bottom"
          >
            <ChevronsLeft aria-hidden="true" strokeWidth={2.25} />
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
            tooltip={nextChapterDisabled ? "You are at the final chapter" : "Next chapter"}
            tooltipPlacement="bottom"
          >
            <ChevronsRight aria-hidden="true" strokeWidth={2.25} />
          </IconButton>
        ) : (
          <span aria-hidden="true" className="reader-toolbar__chapter-spacer" />
        )}
      </div>
      <div className="reader-toolbar__navigation">
        <IconButton
          aria-keyshortcuts={historyBackAriaKeyShortcuts}
          disabled={historyBackDisabled}
          disabledReason="No earlier Reader location"
          label="Back in reading history"
          onClick={onHistoryBack}
          size="compact"
          tooltip={historyBackDisabled ? "No earlier Reader location" : "Back in reading history"}
          tooltipPlacement="bottom"
        >
          <Undo2 aria-hidden="true" strokeWidth={2.25} />
        </IconButton>
        <IconButton
          aria-keyshortcuts={historyForwardAriaKeyShortcuts}
          disabled={historyForwardDisabled}
          disabledReason="No later Reader location"
          label="Forward in reading history"
          onClick={onHistoryForward}
          size="compact"
          tooltip={
            historyForwardDisabled ? "No later Reader location" : "Forward in reading history"
          }
          tooltipPlacement="bottom"
        >
          <Redo2 aria-hidden="true" strokeWidth={2.25} />
        </IconButton>
        <span className="reader-toolbar__divider" />
        <IconButton
          aria-controls="reader-find-in-book"
          aria-keyshortcuts={searchAriaKeyShortcuts}
          aria-expanded={searchOpen}
          label="Find in book"
          onClick={onSearch}
          ref={searchButtonRef}
          size="compact"
          tooltip="Find in book"
          tooltipPlacement="bottom"
        >
          <Search aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-controls="reader-publication-navigation"
          aria-keyshortcuts={navigationAriaKeyShortcuts}
          aria-expanded={navigationOpen}
          label="Book navigation"
          onClick={onNavigation}
          ref={navigationButtonRef}
          size="compact"
          tooltip="Book navigation"
          tooltipPlacement="bottom"
        >
          <ListTree aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-controls="reader-annotations"
          aria-keyshortcuts={annotationsAriaKeyShortcuts}
          aria-expanded={annotationsOpen}
          label="Annotations"
          onClick={onAnnotations}
          ref={annotationButtonRef}
          size="compact"
          tooltip="Annotations"
          tooltipPlacement="bottom"
        >
          <BookMarked aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-keyshortcuts={bookmarkAriaKeyShortcuts}
          aria-pressed={bookmarkActive}
          aria-busy={bookmarkBusy || undefined}
          disabled={bookmarkToggleDisabled}
          disabledReason={bookmarkToggleDisabledReason}
          label={bookmarkActive ? "Remove bookmark" : "Add bookmark"}
          onClick={onToggleBookmark}
          size="compact"
          tooltip={
            bookmarkToggleDisabledReason ?? (bookmarkActive ? "Remove bookmark" : "Add bookmark")
          }
          tooltipPlacement="bottom"
        >
          <Bookmark aria-hidden="true" fill={bookmarkActive ? "currentColor" : "none"} />
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
          tooltip={
            atStart
              ? mode === "continuous"
                ? "You are at the top"
                : "You are on the first page"
              : mode === "continuous"
                ? "Scroll up"
                : "Previous page"
          }
          tooltipPlacement="bottom"
        >
          <ChevronLeft aria-hidden="true" strokeWidth={2.25} />
        </IconButton>
        <IconButton
          label={mode === "continuous" ? "Scroll down" : "Next page"}
          disabled={atEnd}
          disabledReason={
            mode === "continuous" ? "You are at the end" : "You are on the final page"
          }
          onClick={onNext}
          size="compact"
          tooltip={
            atEnd
              ? mode === "continuous"
                ? "You are at the end"
                : "You are on the final page"
              : mode === "continuous"
                ? "Scroll down"
                : "Next page"
          }
          tooltipPlacement="bottom"
        >
          <ChevronRight aria-hidden="true" strokeWidth={2.25} />
        </IconButton>
        <span className="reader-toolbar__divider" />
        <IconButton
          aria-keyshortcuts={settingsAriaKeyShortcuts}
          label="Reader settings"
          onClick={onSettings}
          ref={settingsButtonRef}
          size="compact"
          tooltip="Reader settings"
          tooltipPlacement="bottom"
        >
          <ALargeSmall aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  );
}
