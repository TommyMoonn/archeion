import {
  ArrowLeft,
  BookmarkSimple,
  BookmarksSimple,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  Lightning,
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
  bookmarkAriaKeyShortcuts?: string;
  bookmarkBusy: boolean;
  bookmarkToggleDisabled: boolean;
  bookmarkToggleDisabledReason?: string;
  annotationsAriaKeyShortcuts?: string;
  annotationsOpen: boolean;
  nextChapterDisabled: boolean;
  backLabel: string;
  onBack: () => void;
  onAnnotations: () => void;
  onToggleBookmark: () => void;
  onNext: () => void;
  onNextChapter: () => void;
  onPrevious: () => void;
  onPreviousChapter: () => void;
  onQuickActions: () => void;
  onSettings: () => void;
  onToc: () => void;
  percentage: number;
  previousChapterDisabled: boolean;
  progressSaveFailed: boolean;
  title: string;
  mode: ReaderMode;
  quickActionsAriaKeyShortcuts?: string;
  settingsAriaKeyShortcuts?: string;
  tocAriaKeyShortcuts?: string;
  settingsButtonRef?: Ref<HTMLButtonElement>;
  tocButtonRef?: Ref<HTMLButtonElement>;
  tocOpen: boolean;
  annotationButtonRef?: Ref<HTMLButtonElement>;
};

export function ReaderToolbar({
  atEnd,
  atStart,
  chapterProgress,
  chapterTitle,
  hasChapterNavigation,
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
  onAnnotations,
  onToggleBookmark,
  onNext,
  onNextChapter,
  onPrevious,
  onPreviousChapter,
  onQuickActions,
  onSettings,
  onToc,
  percentage,
  previousChapterDisabled,
  progressSaveFailed,
  title,
  mode,
  quickActionsAriaKeyShortcuts,
  settingsAriaKeyShortcuts,
  tocAriaKeyShortcuts,
  settingsButtonRef,
  tocButtonRef,
  tocOpen,
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
            tooltip={previousChapterDisabled ? "You are at the first chapter" : "Previous chapter"}
            tooltipPlacement="bottom"
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
            tooltip={nextChapterDisabled ? "You are at the final chapter" : "Next chapter"}
            tooltipPlacement="bottom"
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
          aria-keyshortcuts={tocAriaKeyShortcuts}
          aria-expanded={tocOpen}
          label="Table of contents"
          onClick={onToc}
          ref={tocButtonRef}
          size="compact"
          tooltip="Table of contents"
          tooltipPlacement="bottom"
        >
          <ListBullets aria-hidden="true" weight="regular" />
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
          <BookmarksSimple aria-hidden="true" weight="regular" />
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
          <CaretRight aria-hidden="true" weight="bold" />
        </IconButton>
        <span className="reader-toolbar__divider" />
        <IconButton
          aria-keyshortcuts={quickActionsAriaKeyShortcuts}
          label="Quick Actions"
          onClick={onQuickActions}
          size="compact"
          tooltip="Quick Actions"
          tooltipPlacement="bottom"
        >
          <Lightning aria-hidden="true" weight="regular" />
        </IconButton>
        <IconButton
          aria-keyshortcuts={settingsAriaKeyShortcuts}
          label="Reader settings"
          onClick={onSettings}
          ref={settingsButtonRef}
          size="compact"
          tooltip="Reader settings"
          tooltipPlacement="bottom"
        >
          <TextAa aria-hidden="true" weight="regular" />
        </IconButton>
      </div>
    </header>
  );
}
