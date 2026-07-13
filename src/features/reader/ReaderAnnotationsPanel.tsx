import {
  ArrowSquareOut,
  BookmarkSimple,
  Check,
  DotsThree,
  Highlighter,
  MagnifyingGlass,
  NotePencil,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { MenuItem } from "../../components/MenuItem";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { Annotation } from "../../types/annotation";
import type { ReaderNavigationState } from "../../types/reader";
import { formatMediumDate } from "../../utils/formatters";
import { normalizeReaderHighlightColor } from "./readerHighlights";
import {
  groupReaderAnnotations,
  readerAnnotationEmptyLabel,
  readerAnnotationLabel,
  readerAnnotationRemoveLabel,
  visibleReaderAnnotations,
  type ReaderAnnotationSort,
  type ReaderAnnotationView,
} from "./readerAnnotations";

const ANNOTATION_RENDER_BATCH = 200;
const ACTION_MENU_ESTIMATED_HEIGHT = 168;
const ACTION_MENU_WIDTH = 184;

const VIEW_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Bookmarks", value: "bookmarks" },
  { label: "Highlights", value: "highlights" },
  { label: "Notes", value: "notes" },
] satisfies Array<{ label: string; value: ReaderAnnotationView }>;

const SORT_OPTIONS = [
  { label: "Book order", value: "book-order" },
  { label: "Recently updated", value: "recent" },
] satisfies Array<{ label: string; value: ReaderAnnotationSort }>;

type MenuState = {
  annotation: Annotation;
  trigger: HTMLButtonElement;
  placement: "above" | "below";
  right: number;
  top: number;
};

type PendingPanelAction = {
  annotationId: string;
  kind: "edit-note" | "navigate";
};

type MenuAction =
  | { focus: "removal-confirmation" }
  | { focus: "rename-input" }
  | { focus: "row-trigger"; run: (annotation: Annotation) => void };

type ReaderAnnotationsPanelProps = {
  annotations: readonly Annotation[];
  currentAnnotationId?: string;
  currentCfi?: string;
  loadStatus: "loading" | "ready" | "error";
  navigation: ReaderNavigationState;
  onClose: () => void;
  onEditNote: (annotation: Annotation) => Promise<boolean>;
  onNavigate: (annotation: Annotation) => Promise<boolean>;
  onReload: () => Promise<boolean>;
  onRemove: (annotation: Annotation) => Promise<boolean>;
  onUpdateBookmarkLabel: (annotation: Annotation, label: string) => Promise<boolean>;
};

export function ReaderAnnotationsPanel({
  annotations,
  currentAnnotationId,
  currentCfi,
  loadStatus,
  navigation,
  onClose,
  onEditNote,
  onNavigate,
  onReload,
  onRemove,
  onUpdateBookmarkLabel,
}: ReaderAnnotationsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const removalConfirmationRef = useRef<HTMLDivElement>(null);
  const actionTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusRestoreRequestRef = useRef<{ annotationId?: string } | undefined>(undefined);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [view, setView] = useState<ReaderAnnotationView>("all");
  const [sort, setSort] = useState<ReaderAnnotationSort>("book-order");
  const [renderLimit, setRenderLimit] = useState(ANNOTATION_RENDER_BATCH);
  const [menu, setMenu] = useState<MenuState>();
  const [editingId, setEditingId] = useState<string>();
  const [draftLabel, setDraftLabel] = useState("");
  const [pendingRemovalId, setPendingRemovalId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [pendingPanelAction, setPendingPanelAction] = useState<PendingPanelAction>();
  const [actionError, setActionError] = useState<string>();

  const visible = useMemo(
    () =>
      visibleReaderAnnotations({
        annotations,
        chapters: navigation.chapters,
        query: deferredQuery,
        sort,
        view,
      }),
    [annotations, deferredQuery, navigation.chapters, sort, view],
  );
  const renderedAnnotations = useMemo(() => visible.slice(0, renderLimit), [renderLimit, visible]);
  const groups = useMemo(
    () => groupReaderAnnotations(renderedAnnotations, navigation.chapters),
    [navigation.chapters, renderedAnnotations],
  );
  const hasMore = renderLimit < visible.length;

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (menu) {
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }

    if (editingId) {
      renameInputRef.current?.focus();
      return;
    }

    if (pendingRemovalId) {
      removalConfirmationRef.current
        ?.querySelector<HTMLButtonElement>("[data-confirm-annotation-removal]")
        ?.focus();
      return;
    }

    const focusRequest = focusRestoreRequestRef.current;
    if (!focusRequest) return;
    focusRestoreRequestRef.current = undefined;
    const requestedTrigger = focusRequest.annotationId
      ? actionTriggerRefs.current.get(focusRequest.annotationId)
      : undefined;
    const fallbackTrigger = actionTriggerRefs.current.values().next().value;
    (requestedTrigger ?? fallbackTrigger ?? searchRef.current ?? panelRef.current)?.focus();
  });

  useEffect(() => {
    if (!menu) return;

    function dismissMenu(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.contains(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-annotation-menu-trigger]")
      ) {
        return;
      }
      setMenu(undefined);
    }

    document.addEventListener("pointerdown", dismissMenu, true);
    return () => {
      document.removeEventListener("pointerdown", dismissMenu, true);
    };
  }, [menu]);

  function resetTransientState() {
    setRenderLimit(ANNOTATION_RENDER_BATCH);
    setMenu(undefined);
    setEditingId(undefined);
    setPendingRemovalId(undefined);
    setActionError(undefined);
  }

  function changeView(nextView: ReaderAnnotationView) {
    resetTransientState();
    setView(nextView);
  }

  function changeSort(nextSort: ReaderAnnotationSort) {
    resetTransientState();
    setSort(nextSort);
  }

  function changeQuery(nextQuery: string) {
    resetTransientState();
    setQuery(nextQuery);
  }

  function closeMenuAndRestoreFocus() {
    const trigger = menu?.trigger;
    setMenu(undefined);
    trigger?.focus();
  }

  function requestRowFocus(annotationId?: string) {
    focusRestoreRequestRef.current = { annotationId };
  }

  function cancelBookmarkRename(annotationId: string) {
    requestRowFocus(annotationId);
    setEditingId(undefined);
  }

  function cancelRemoval(annotationId: string) {
    requestRowFocus(annotationId);
    setPendingRemovalId(undefined);
  }

  function survivingRowId(annotationId: string): string | undefined {
    const index = visible.findIndex((annotation) => annotation.id === annotationId);
    return visible[index + 1]?.id ?? visible[index - 1]?.id;
  }

  function openMenu(event: ReactMouseEvent<HTMLButtonElement>, annotation: Annotation) {
    if (pendingPanelAction) return;

    const panelRect = panelRef.current?.getBoundingClientRect();
    const triggerRect = event.currentTarget.getBoundingClientRect();
    if (!panelRect) return;

    if (menu?.annotation.id === annotation.id) {
      setMenu(undefined);
      return;
    }

    const availableBelow = panelRect.bottom - triggerRect.bottom;
    const placement =
      availableBelow >= ACTION_MENU_ESTIMATED_HEIGHT ||
      triggerRect.top - panelRect.top < availableBelow
        ? "below"
        : "above";
    const unclampedRight = panelRect.right - triggerRect.right;
    const right = Math.max(8, Math.min(panelRect.width - ACTION_MENU_WIDTH - 8, unclampedRight));

    setMenu({
      annotation,
      trigger: event.currentTarget,
      placement,
      right,
      top:
        placement === "below"
          ? triggerRect.bottom - panelRect.top + 4
          : triggerRect.top - panelRect.top - 4,
    });
  }

  async function navigate(annotation: Annotation) {
    if (busyId || pendingPanelAction) return;
    setPendingPanelAction({ annotationId: annotation.id, kind: "navigate" });
    setActionError(undefined);
    try {
      const opened = await onNavigate(annotation);
      if (opened) {
        onClose();
      } else {
        setActionError("That annotation could not be opened.");
      }
    } catch {
      setActionError("That annotation could not be opened.");
    } finally {
      setPendingPanelAction(undefined);
    }
  }

  async function editNote(annotation: Annotation) {
    if (busyId || pendingPanelAction) return;
    setPendingPanelAction({ annotationId: annotation.id, kind: "edit-note" });
    setActionError(undefined);
    try {
      const opened = await onEditNote(annotation);
      if (!opened) {
        setActionError("That note could not be opened.");
      }
    } catch {
      setActionError("That note could not be opened.");
    } finally {
      setPendingPanelAction(undefined);
    }
  }

  async function saveBookmarkLabel(annotation: Annotation) {
    if (busyId) return;
    setBusyId(annotation.id);
    setActionError(undefined);
    try {
      const saved = await onUpdateBookmarkLabel(annotation, draftLabel);
      if (saved) {
        requestRowFocus(annotation.id);
        setEditingId(undefined);
      } else {
        setActionError("The bookmark label could not be saved.");
      }
    } catch {
      setActionError("The bookmark label could not be saved.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function removeAnnotation(annotation: Annotation) {
    if (busyId) return;
    setBusyId(annotation.id);
    setActionError(undefined);
    try {
      const removed = await onRemove(annotation);
      if (removed) {
        requestRowFocus(survivingRowId(annotation.id));
        setPendingRemovalId(undefined);
      } else {
        setActionError("The annotation could not be removed.");
      }
    } catch {
      setActionError("The annotation could not be removed.");
    } finally {
      setBusyId(undefined);
    }
  }

  function beginBookmarkRename(annotation: Annotation) {
    setPendingRemovalId(undefined);
    setDraftLabel(annotation.label ?? "");
    setEditingId(annotation.id);
  }

  function beginRemoval(annotation: Annotation) {
    setEditingId(undefined);
    setPendingRemovalId(annotation.id);
  }

  function chooseMenuAction(action: MenuAction) {
    const activeMenu = menu;
    if (!activeMenu) return;

    setMenu(undefined);
    switch (action.focus) {
      case "row-trigger":
        activeMenu.trigger.focus();
        action.run(activeMenu.annotation);
        return;
      case "rename-input":
        beginBookmarkRename(activeMenu.annotation);
        return;
      case "removal-confirmation":
        beginRemoval(activeMenu.annotation);
    }
  }

  return (
    <aside
      aria-label="Annotations"
      className="reader-toc reader-annotations"
      data-reader-ignore-shortcuts
      id="reader-annotations"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (menu) {
          closeMenuAndRestoreFocus();
        } else if (editingId) {
          cancelBookmarkRename(editingId);
        } else if (pendingRemovalId) {
          cancelRemoval(pendingRemovalId);
        } else {
          onClose();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      ref={panelRef}
      tabIndex={-1}
    >
      <header className="reader-panel-header">
        <div>
          <p>Reading</p>
          <h2>Annotations</h2>
        </div>
        <IconButton label="Close annotations" onClick={onClose} size="compact">
          <X aria-hidden="true" />
        </IconButton>
      </header>

      <div className="reader-annotations__controls">
        <SegmentedControl
          className="reader-annotations__views"
          label="Annotation view"
          onChange={changeView}
          options={VIEW_OPTIONS}
          size="compact"
          value={view}
        />
        <div className="reader-annotations__tools">
          <Input
            className="reader-annotations__search"
            icon={<MagnifyingGlass aria-hidden="true" size={16} />}
            label="Search annotations"
            onChange={(event) => changeQuery(event.currentTarget.value)}
            placeholder="Search quotes and notes"
            ref={searchRef}
            size="standard"
            type="search"
            value={query}
          />
          <AppSelect
            ariaLabel="Sort annotations"
            className="reader-annotations__sort"
            id="reader-annotations-sort"
            onChange={changeSort}
            options={SORT_OPTIONS}
            size="standard"
            value={sort}
          />
        </div>
      </div>

      <div className="reader-toc__body reader-annotations__body">
        {loadStatus === "loading" ? <AnnotationLoadingState /> : null}

        {loadStatus === "error" ? (
          <div className="reader-annotations__load-error" role="alert">
            <p>Annotations could not be loaded.</p>
            <Button onClick={() => void onReload()} size="compact" variant="secondary">
              Retry
            </Button>
          </div>
        ) : null}

        {loadStatus === "ready" && annotations.length === 0 ? (
          <AnnotationEmptyState label="No annotations">
            Bookmarks, highlights, and notes appear here.
          </AnnotationEmptyState>
        ) : null}

        {loadStatus === "ready" && annotations.length > 0 && visible.length === 0 ? (
          <AnnotationEmptyState
            label={query.trim() ? "No matches" : readerAnnotationEmptyLabel(view)}
          >
            {query.trim() ? "Try a different quote or note search." : "Nothing in this view yet."}
          </AnnotationEmptyState>
        ) : null}

        {loadStatus === "ready" && visible.length > 0 ? (
          <div className="reader-annotations__groups">
            {groups.map((group) => (
              <section className="reader-annotations__group" key={group.key}>
                <h3>{group.label}</h3>
                <ol className="reader-annotations__list">
                  {group.annotations.map((annotation) => {
                    const label = readerAnnotationLabel(annotation);
                    const isBusy = busyId === annotation.id;
                    const isPanelActionPending = pendingPanelAction?.annotationId === annotation.id;
                    const isNavigationPending =
                      isPanelActionPending && pendingPanelAction.kind === "navigate";
                    const isEditing = editingId === annotation.id;
                    const isPendingRemoval = pendingRemovalId === annotation.id;
                    const canNavigate = Boolean(annotation.cfiRange?.trim());
                    const isCurrent = Boolean(
                      currentAnnotationId === annotation.id ||
                      (currentCfi?.trim() && annotation.cfiRange?.trim() === currentCfi.trim()),
                    );

                    return (
                      <li
                        className="reader-annotations__item"
                        data-current={isCurrent || undefined}
                        key={annotation.id}
                      >
                        <article>
                          {isEditing ? (
                            <form
                              className="reader-annotations__rename"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void saveBookmarkLabel(annotation);
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
                                  onChange={(event) => setDraftLabel(event.currentTarget.value)}
                                  ref={renameInputRef}
                                  value={draftLabel}
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
                                  onClick={() => cancelBookmarkRename(annotation.id)}
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
                                aria-label={`Go to ${label}`}
                                className="reader-annotations__target"
                                disabled={!canNavigate || isBusy || isNavigationPending}
                                onClick={() => void navigate(annotation)}
                                title={
                                  canNavigate ? undefined : "This annotation has no saved location."
                                }
                                type="button"
                              >
                                <AnnotationContent annotation={annotation} />
                              </button>
                              <button
                                aria-expanded={menu?.annotation.id === annotation.id}
                                aria-haspopup="menu"
                                aria-label={`Actions for ${label}`}
                                aria-busy={isPanelActionPending || undefined}
                                className="menu-trigger reader-annotations__menu-trigger"
                                data-annotation-menu-trigger
                                disabled={Boolean(busyId)}
                                aria-disabled={pendingPanelAction ? true : undefined}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openMenu(event, annotation);
                                }}
                                ref={(node) => {
                                  if (node) {
                                    actionTriggerRefs.current.set(annotation.id, node);
                                  } else {
                                    actionTriggerRefs.current.delete(annotation.id);
                                  }
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
                              <span>{readerAnnotationRemoveLabel(annotation)}?</span>
                              <Button
                                busy={isBusy}
                                data-confirm-annotation-removal
                                disabled={isBusy}
                                onClick={() => void removeAnnotation(annotation)}
                                size="compact"
                                variant="danger"
                              >
                                Remove
                              </Button>
                              <Button
                                disabled={isBusy}
                                onClick={() => cancelRemoval(annotation.id)}
                                size="compact"
                                variant="ghost"
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : null}
                        </article>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}

            {hasMore ? (
              <button
                className="reader-annotations__show-more"
                onClick={() => setRenderLimit((current) => current + ANNOTATION_RENDER_BATCH)}
                type="button"
              >
                Show more <span>{visible.length - renderLimit} remaining</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {menu ? (
        <div
          className="menu-popover reader-annotations__menu-popover"
          data-placement={menu.placement}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeMenuAndRestoreFocus();
            }
          }}
          ref={menuRef}
          role="menu"
          style={
            {
              "--annotation-menu-right": `${menu.right}px`,
              "--annotation-menu-top": `${menu.top}px`,
            } as CSSProperties
          }
        >
          <MenuItem
            disabled={!menu.annotation.cfiRange?.trim()}
            icon={<ArrowSquareOut weight="regular" />}
            onClick={() =>
              chooseMenuAction({
                focus: "row-trigger",
                run: (annotation) => void navigate(annotation),
              })
            }
          >
            Go to location
          </MenuItem>
          <MenuItem
            icon={<NotePencil weight="regular" />}
            onClick={() =>
              chooseMenuAction({
                focus: "row-trigger",
                run: (annotation) => void editNote(annotation),
              })
            }
          >
            Edit note
          </MenuItem>
          {menu.annotation.type === "bookmark" ? (
            <MenuItem
              icon={<PencilSimple weight="regular" />}
              onClick={() => chooseMenuAction({ focus: "rename-input" })}
            >
              Rename bookmark
            </MenuItem>
          ) : null}
          <MenuItem
            danger
            icon={<Trash weight="regular" />}
            onClick={() => chooseMenuAction({ focus: "removal-confirmation" })}
          >
            {readerAnnotationRemoveLabel(menu.annotation)}
          </MenuItem>
        </div>
      ) : null}

      {actionError ? (
        <p className="reader-toc__error" role="alert">
          {actionError}
        </p>
      ) : null}
    </aside>
  );
}

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
