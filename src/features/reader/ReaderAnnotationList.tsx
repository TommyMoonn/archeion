import {
  BookmarkSimple,
  Check,
  DotsThree,
  Highlighter,
  NotePencil,
  X,
} from "@phosphor-icons/react";
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { Annotation, BookmarkAnnotation } from "../../types/annotation";
import { formatMediumDate } from "../../utils/formatters";
import type { ReaderAnnotationListModel } from "./readerAnnotationListModel";
import { readerAnnotationFocusFallbackId } from "./readerAnnotationListModel";
import { normalizeReaderHighlightColor } from "./readerHighlights";
import {
  readerAnnotationEmptyLabel,
  readerAnnotationLabel,
  readerAnnotationRemovalPrompt,
  type ReaderAnnotationView,
} from "./readerAnnotations";
import type {
  ReaderAnnotationPanelAction,
  ReaderAnnotationRecoveryFeedback,
  ReaderAnnotationRowMutation,
} from "./useReaderAnnotationPanelActions";

export type ReaderAnnotationListHandle = {
  focusActionTrigger: (annotationId?: string) => boolean;
  requestActionFocus: (annotationId?: string) => void;
};

type ReaderAnnotationListProps = {
  annotationCount: number;
  bookmarkDraftLabel: string;
  currentAnnotationId?: string;
  currentCfi?: string;
  editingAnnotationId?: string;
  loadStatus: "loading" | "ready" | "error";
  menuAnnotationId?: string;
  model: ReaderAnnotationListModel;
  onCancelBookmarkRename: (annotationId: string) => void;
  onCancelRemoval: (annotationId: string) => void;
  onChangeBookmarkDraftLabel: (label: string) => void;
  onFocusFallback: () => void;
  onNavigate: (annotation: Annotation) => void;
  onOpenMenu: (event: ReactMouseEvent<HTMLButtonElement>, annotation: Annotation) => void;
  onReload: () => void;
  onRemove: (annotation: Annotation) => void;
  onSaveBookmarkLabel: (annotation: BookmarkAnnotation) => void;
  onShowMore: () => void;
  panelAction?: ReaderAnnotationPanelAction;
  panelId: string;
  pendingRemovalId?: string;
  query: string;
  recoveryFeedback?: ReaderAnnotationRecoveryFeedback;
  rowMutation?: ReaderAnnotationRowMutation;
  view: ReaderAnnotationView;
};

export const ReaderAnnotationList = forwardRef<
  ReaderAnnotationListHandle,
  ReaderAnnotationListProps
>(function ReaderAnnotationList(
  {
    annotationCount,
    bookmarkDraftLabel,
    currentAnnotationId,
    currentCfi,
    editingAnnotationId,
    loadStatus,
    menuAnnotationId,
    model,
    onCancelBookmarkRename,
    onCancelRemoval,
    onChangeBookmarkDraftLabel,
    onFocusFallback,
    onNavigate,
    onOpenMenu,
    onReload,
    onRemove,
    onSaveBookmarkLabel,
    onShowMore,
    panelAction,
    panelId,
    pendingRemovalId,
    query,
    recoveryFeedback,
    rowMutation,
    view,
  },
  forwardedRef,
) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const removalConfirmationRef = useRef<HTMLDivElement>(null);
  const actionTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusRequestRef = useRef<{ annotationId?: string } | undefined>(undefined);

  function focusActionTrigger(annotationId?: string): boolean {
    const availableIds = [...actionTriggerRefs.current.keys()];
    const targetId = readerAnnotationFocusFallbackId(annotationId, availableIds);
    const trigger = targetId ? actionTriggerRefs.current.get(targetId) : undefined;
    trigger?.focus();
    return Boolean(trigger);
  }

  useImperativeHandle(
    forwardedRef,
    () => ({
      focusActionTrigger,
      requestActionFocus(annotationId?: string) {
        focusRequestRef.current = { annotationId };
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    if (editingAnnotationId) {
      renameInputRef.current?.focus();
      return;
    }
    if (pendingRemovalId) {
      removalConfirmationRef.current
        ?.querySelector<HTMLButtonElement>("[data-confirm-annotation-removal]")
        ?.focus();
      return;
    }
    const request = focusRequestRef.current;
    if (!request) return;
    focusRequestRef.current = undefined;
    if (!focusActionTrigger(request.annotationId)) onFocusFallback();
  });

  return (
    <div
      className="reader-toc__body reader-annotations__body"
      onKeyDown={handleRowKeyboardNavigation}
      ref={bodyRef}
    >
      {loadStatus === "loading" ? <AnnotationLoadingState /> : null}

      {loadStatus === "error" ? (
        <div className="reader-annotations__load-error" role="alert">
          <p>Annotations could not be loaded.</p>
          <Button onClick={onReload} size="compact" variant="secondary">
            Retry
          </Button>
        </div>
      ) : null}

      {loadStatus === "ready" && annotationCount === 0 ? (
        <AnnotationEmptyState label="No annotations">
          Bookmarks and highlights appear here. Highlights can include notes.
        </AnnotationEmptyState>
      ) : null}

      {loadStatus === "ready" && annotationCount > 0 && model.visibleAnnotations.length === 0 ? (
        <AnnotationEmptyState
          label={query.trim() ? "No matches" : readerAnnotationEmptyLabel(view)}
        >
          {query.trim() ? "Try a different search." : "Nothing in this view yet."}
        </AnnotationEmptyState>
      ) : null}

      {loadStatus === "ready" && model.visibleAnnotations.length > 0 ? (
        <div className="reader-annotations__groups">
          {model.groups.map((group) => (
            <section className="reader-annotations__group" key={group.key}>
              <h3>{group.label}</h3>
              <ol className="reader-annotations__list">
                {group.annotations.map((annotation) => {
                  const label = readerAnnotationLabel(annotation);
                  const isBusy = rowMutation?.annotationId === annotation.id;
                  const isPanelActionPending = panelAction?.annotationId === annotation.id;
                  const isNavigationPending =
                    isPanelActionPending && panelAction.kind === "navigate";
                  const isEditing = editingAnnotationId === annotation.id;
                  const isPendingRemoval = pendingRemovalId === annotation.id;
                  const canNavigate = Boolean(
                    annotation.anchorStatus !== "detached" && annotation.cfiRange?.trim(),
                  );
                  const navigationUnavailableReasonId = canNavigate
                    ? undefined
                    : `${panelId}-navigation-${encodeURIComponent(annotation.id)}`;
                  const isCurrent = Boolean(
                    annotation.anchorStatus !== "detached" &&
                    (currentAnnotationId === annotation.id ||
                      (currentCfi?.trim() && annotation.cfiRange?.trim() === currentCfi.trim())),
                  );

                  return (
                    <li
                      className="reader-annotations__item"
                      data-current={isCurrent || undefined}
                      data-detached={annotation.anchorStatus === "detached" || undefined}
                      key={annotation.id}
                    >
                      <article>
                        {isEditing && annotation.type === "bookmark" ? (
                          <form
                            className="reader-annotations__rename"
                            onSubmit={(event) => {
                              event.preventDefault();
                              onSaveBookmarkLabel(annotation);
                            }}
                          >
                            <label htmlFor={`annotation-label-${annotation.id}`}>
                              Bookmark label
                            </label>
                            <div>
                              <input
                                disabled={isBusy}
                                id={`annotation-label-${annotation.id}`}
                                maxLength={80}
                                onChange={(event) =>
                                  onChangeBookmarkDraftLabel(event.currentTarget.value)
                                }
                                ref={renameInputRef}
                                value={bookmarkDraftLabel}
                              />
                              <IconButton
                                aria-busy={isBusy || undefined}
                                disabled={isBusy}
                                label="Save bookmark label"
                                size="compact"
                                type="submit"
                              >
                                <Check aria-hidden="true" />
                              </IconButton>
                              <IconButton
                                disabled={isBusy}
                                label="Cancel bookmark rename"
                                onClick={() => onCancelBookmarkRename(annotation.id)}
                                size="compact"
                              >
                                <X aria-hidden="true" />
                              </IconButton>
                            </div>
                          </form>
                        ) : (
                          <>
                            <button
                              aria-current={isCurrent ? "location" : undefined}
                              aria-describedby={navigationUnavailableReasonId}
                              aria-disabled={!canNavigate || undefined}
                              aria-label={`Go to ${label}`}
                              className="reader-annotations__target"
                              data-annotation-row-target
                              disabled={isBusy || isNavigationPending}
                              onClick={(event) => {
                                if (!canNavigate) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  return;
                                }
                                onNavigate(annotation);
                              }}
                              type="button"
                            >
                              <AnnotationContent annotation={annotation} />
                              {navigationUnavailableReasonId ? (
                                <span className="sr-only" id={navigationUnavailableReasonId}>
                                  This annotation has no saved location.
                                </span>
                              ) : null}
                            </button>
                            <button
                              aria-busy={isPanelActionPending || undefined}
                              aria-disabled={panelAction ? true : undefined}
                              aria-expanded={menuAnnotationId === annotation.id}
                              aria-haspopup="menu"
                              aria-label={`Actions for ${label}`}
                              className="menu-trigger reader-annotations__menu-trigger"
                              data-annotation-menu-trigger
                              disabled={Boolean(rowMutation)}
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenMenu(event, annotation);
                              }}
                              ref={(node) => {
                                if (node) actionTriggerRefs.current.set(annotation.id, node);
                                else actionTriggerRefs.current.delete(annotation.id);
                              }}
                              type="button"
                            >
                              <span aria-hidden="true" className="icon-slot">
                                <DotsThree weight="bold" />
                              </span>
                            </button>
                          </>
                        )}

                        {isPendingRemoval ? (
                          <div
                            className="reader-annotations__confirmation"
                            ref={removalConfirmationRef}
                          >
                            <span>{readerAnnotationRemovalPrompt(annotation)}</span>
                            <Button
                              busy={isBusy}
                              data-confirm-annotation-removal
                              disabled={isBusy}
                              onClick={() => onRemove(annotation)}
                              size="compact"
                              variant="danger"
                            >
                              Remove
                            </Button>
                            <Button
                              disabled={isBusy}
                              onClick={() => onCancelRemoval(annotation.id)}
                              size="compact"
                              variant="ghost"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : null}

                        {recoveryFeedback?.annotationId === annotation.id ? (
                          <span
                            className="reader-annotations__recovery-status"
                            data-status={recoveryFeedback.status}
                            role={
                              recoveryFeedback.status === "failed" ||
                              recoveryFeedback.status === "warning"
                                ? "alert"
                                : "status"
                            }
                          >
                            {recoveryFeedback.message}
                          </span>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          {model.hasMore ? (
            <button className="reader-annotations__show-more" onClick={onShowMore} type="button">
              Show more <span>{model.remaining} remaining</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  function handleRowKeyboardNavigation(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"].includes(event.key)) {
      return;
    }
    const eventTarget = event.target instanceof Element ? event.target : null;
    const control = eventTarget?.closest<HTMLButtonElement>(
      "[data-annotation-row-target], [data-annotation-menu-trigger]",
    );
    if (!control || !bodyRef.current?.contains(control)) return;
    const row = control.closest<HTMLElement>(".reader-annotations__item");
    if (!row) return;

    let destination: HTMLButtonElement | null | undefined;
    if (event.key === "ArrowRight" && control.hasAttribute("data-annotation-row-target")) {
      destination = row.querySelector<HTMLButtonElement>("[data-annotation-menu-trigger]");
    } else if (event.key === "ArrowLeft" && control.hasAttribute("data-annotation-menu-trigger")) {
      destination = row.querySelector<HTMLButtonElement>(
        "[data-annotation-row-target]:not(:disabled)",
      );
    } else if (["ArrowDown", "ArrowUp", "End", "Home"].includes(event.key)) {
      const selector = control.hasAttribute("data-annotation-menu-trigger")
        ? "[data-annotation-menu-trigger]"
        : "[data-annotation-row-target]:not(:disabled)";
      const controls = Array.from(
        bodyRef.current.querySelectorAll<HTMLButtonElement>(selector),
      ).filter((candidate) => !candidate.disabled);
      const currentIndex = controls.indexOf(control);
      if (event.key === "Home") destination = controls[0];
      else if (event.key === "End") destination = controls.at(-1);
      else if (event.key === "ArrowDown") destination = controls[currentIndex + 1];
      else destination = controls[currentIndex - 1];
    }

    if (!destination || destination === control) return;
    event.preventDefault();
    event.stopPropagation();
    destination.focus();
  }
});

function AnnotationContent({ annotation }: { annotation: Annotation }) {
  const label = readerAnnotationLabel(annotation);
  const selectedText = annotation.selectedText?.trim();
  const note = annotation.note?.trim();
  const highlightColor = normalizeReaderHighlightColor(annotation.color);

  return (
    <>
      <span className="reader-annotations__type">
        <span aria-hidden="true" className="icon-slot icon-slot--compact">
          {annotation.type === "bookmark" ? (
            <BookmarkSimple weight="fill" />
          ) : (
            <Highlighter weight="regular" />
          )}
        </span>
        <span>{label}</span>
        {annotation.type === "highlight" ? (
          <span
            aria-label={`${highlightColor} highlight`}
            className="reader-annotations__color"
            data-color={highlightColor}
            role="img"
          />
        ) : null}
        {annotation.anchorStatus === "detached" ? (
          <span className="reader-annotations__anchor-status">Detached</span>
        ) : null}
      </span>
      {selectedText ? <span className="reader-annotations__quote">{selectedText}</span> : null}
      {note ? <span className="reader-annotations__note">{note}</span> : null}
      {!selectedText && !note && annotation.type !== "bookmark" ? (
        <span className="reader-annotations__missing-text">No saved text</span>
      ) : null}
      <time dateTime={annotation.updatedAt}>Updated {formatMediumDate(annotation.updatedAt)}</time>
    </>
  );
}

function AnnotationEmptyState({ children, label }: { children: string; label: string }) {
  return (
    <div className="reader-toc__empty reader-annotations__empty">
      <NotePencil aria-hidden="true" size={28} weight="thin" />
      <p>{label}</p>
      <span>{children}</span>
    </div>
  );
}

function AnnotationLoadingState() {
  return (
    <div aria-label="Loading annotations" className="reader-toc__loading" role="status">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
