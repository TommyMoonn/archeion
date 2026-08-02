import { Download, Search, X } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { MenuItem } from "../../components/MenuItem";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Tooltip } from "../../components/Tooltip";
import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderNavigationState } from "../../types/reader";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
import { useTransientSurfaceOwnership } from "../../utils/transientSurfaceOwnership";
import { ReaderAnnotationActionMenu } from "./ReaderAnnotationActionMenu";
import { ReaderAnnotationList, type ReaderAnnotationListHandle } from "./ReaderAnnotationList";
import type { ReaderAnnotationExportFormat } from "./readerAnnotationExport";
import type { ReaderAnnotationExportResult } from "./readerAnnotationExportFile";
import {
  createReaderAnnotationListModel,
  nextReaderAnnotationRenderLimit,
  READER_ANNOTATION_RENDER_BATCH,
  readerAnnotationSurvivingRowId,
} from "./readerAnnotationListModel";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import type { ReaderHighlightColor } from "./readerHighlights";
import { type ReaderAnnotationSort, type ReaderAnnotationView } from "./readerAnnotations";
import { useReaderAnnotationActionMenu } from "./useReaderAnnotationActionMenu";
import { useReaderAnnotationPanelActions } from "./useReaderAnnotationPanelActions";
import { ReaderSidePanel } from "./ReaderSidePanel";

const VIEW_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Bookmarks", value: "bookmarks" },
  { label: "Highlights", value: "highlights" },
] satisfies Array<{ label: string; value: ReaderAnnotationView }>;

const SORT_OPTIONS = [
  { label: "Book order", value: "book-order" },
  { label: "Recently updated", value: "recent" },
] satisfies Array<{ label: string; value: ReaderAnnotationSort }>;

type ReaderAnnotationsPanelProps = {
  active?: boolean;
  annotations: readonly Annotation[];
  currentAnnotationId?: string;
  currentCfi?: string;
  loadStatus: "loading" | "ready" | "error";
  navigation: ReaderNavigationState;
  onClose: () => void;
  onEditNote: (annotation: HighlightAnnotation) => Promise<boolean>;
  onExport: (format: ReaderAnnotationExportFormat) => Promise<ReaderAnnotationExportResult>;
  onNavigate: (annotation: Annotation) => Promise<boolean>;
  onRecolorHighlight: (annotationId: string, color: ReaderHighlightColor) => Promise<boolean>;
  onRecover: (annotation: Annotation) => Promise<ReaderAnnotationRecoveryResult>;
  onReload: () => Promise<boolean>;
  onRemove: (annotation: Annotation) => Promise<boolean>;
  onUpdateBookmarkLabel: (annotation: BookmarkAnnotation, label: string) => Promise<boolean>;
  restoreFocusAnnotationId?: string;
  searchAriaKeyShortcuts?: string;
  searchInputRef?: RefObject<HTMLInputElement | null>;
};

export function ReaderAnnotationsPanel({
  active = true,
  annotations,
  currentAnnotationId,
  currentCfi,
  loadStatus,
  navigation,
  onClose,
  onEditNote,
  onExport,
  onNavigate,
  onRecolorHighlight,
  onRecover,
  onReload,
  onRemove,
  onUpdateBookmarkLabel,
  restoreFocusAnnotationId,
  searchAriaKeyShortcuts,
  searchInputRef,
}: ReaderAnnotationsPanelProps) {
  const panelId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const localSearchRef = useRef<HTMLInputElement>(null);
  const searchRef = searchInputRef ?? localSearchRef;
  const listRef = useRef<ReaderAnnotationListHandle>(null);
  const { closeDetails: closeExportDetails, detailsRef: exportMenuRef } = useDismissibleDetails();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [view, setView] = useState<ReaderAnnotationView>("all");
  const [sort, setSort] = useState<ReaderAnnotationSort>("book-order");
  const [renderLimit, setRenderLimit] = useState(READER_ANNOTATION_RENDER_BATCH);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const listModel = useMemo(
    () =>
      createReaderAnnotationListModel({
        annotations,
        chapters: navigation.chapters,
        query: deferredQuery,
        renderLimit,
        sort,
        view,
      }),
    [annotations, deferredQuery, navigation.chapters, renderLimit, sort, view],
  );

  const requestRowFocus = useCallback((annotationId?: string) => {
    listRef.current?.requestActionFocus(annotationId);
  }, []);
  const focusPanelFallback = useCallback(() => {
    const searchInput = searchInputRef?.current ?? localSearchRef.current;
    if (searchInput?.isConnected && !searchInput.disabled) {
      searchInput.focus({ preventScroll: true });
      if (document.activeElement === searchInput) return;
    }
    panelRef.current?.focus({ preventScroll: true });
  }, [searchInputRef]);
  const survivingRowId = useCallback(
    (annotationId: string) =>
      readerAnnotationSurvivingRowId(listModel.visibleAnnotations, annotationId),
    [listModel.visibleAnnotations],
  );
  const actions = useReaderAnnotationPanelActions({
    onClose,
    onEditNote,
    onExport,
    onNavigate,
    onRecolorHighlight,
    onRecover,
    onRemove,
    onUpdateBookmarkLabel,
    requestRowFocus,
    survivingRowId,
  });
  const actionMenu = useReaderAnnotationActionMenu({
    blocked: Boolean(actions.panelAction),
    panelRef,
  });

  useLayoutEffect(() => {
    if (!active) return;
    const focusedRow = restoreFocusAnnotationId
      ? listRef.current?.focusActionTrigger(restoreFocusAnnotationId)
      : false;
    if (!focusedRow) {
      (searchInputRef?.current ?? localSearchRef.current ?? panelRef.current)?.focus({
        preventScroll: true,
      });
    }
  }, [active, restoreFocusAnnotationId, searchInputRef]);

  function handlePanelEscape() {
    if (actionMenu.menu) {
      actionMenu.handleEscape();
    } else if (exportMenuRef.current?.open) {
      closeExportMenu({ restoreFocus: true });
    } else if (actions.editing) {
      actions.cancelBookmarkRename(actions.editing.annotationId);
    } else if (actions.pendingRemovalId) {
      actions.cancelRemoval(actions.pendingRemovalId);
    } else {
      onClose();
    }
  }

  useTransientSurfaceOwnership({
    active,
    elementRef: panelRef,
    kind: "reader-panel",
    onDismiss: (reason) => {
      if (reason === "escape") handlePanelEscape();
    },
  });

  function closeExportMenu(options: { restoreFocus?: boolean } = {}) {
    closeExportDetails(options);
    setExportMenuOpen(false);
  }

  function resetListTransientState() {
    setRenderLimit(READER_ANNOTATION_RENDER_BATCH);
    actionMenu.close();
    actions.resetTransientState();
  }

  function changeView(nextView: ReaderAnnotationView) {
    resetListTransientState();
    setView(nextView);
  }

  function changeSort(nextSort: ReaderAnnotationSort) {
    resetListTransientState();
    setSort(nextSort);
  }

  function changeQuery(nextQuery: string) {
    resetListTransientState();
    setQuery(nextQuery);
  }

  async function exportAnnotations(format: ReaderAnnotationExportFormat) {
    closeExportMenu({ restoreFocus: true });
    await actions.exportAnnotations(format);
  }

  return (
    <ReaderSidePanel
      accessibleLabel="Annotations"
      className="reader-annotations"
      closeLabel="Close annotations"
      eyebrow="Reading"
      headerActions={
        <details
          className="reader-annotations__export-menu"
          onToggle={(event) => setExportMenuOpen(event.currentTarget.open)}
          ref={exportMenuRef}
        >
          <Tooltip content="Export annotations">
            <summary aria-haspopup="menu" aria-label="Export annotations" className="menu-trigger">
              <span aria-hidden="true" className="icon-slot icon-slot--compact">
                <Download />
              </span>
            </summary>
          </Tooltip>
          <div className="menu-popover" role={exportMenuOpen ? "menu" : undefined}>
            <MenuItem
              disabled={actions.exportState?.status === "exporting"}
              onClick={() => void exportAnnotations("markdown")}
            >
              Export Markdown
            </MenuItem>
            <MenuItem
              disabled={actions.exportState?.status === "exporting"}
              onClick={() => void exportAnnotations("json")}
            >
              Export JSON
            </MenuItem>
          </div>
        </details>
      }
      hidden={!active}
      id={active ? "reader-annotations" : undefined}
      ignoreReaderShortcuts
      onClose={onClose}
      ref={panelRef}
      tabIndex={-1}
      title="Annotations"
    >
      {actions.exportState ? (
        <div
          className="reader-annotations__export-status"
          data-status={actions.exportState.status}
          role={actions.exportState.status === "error" ? "alert" : "status"}
        >
          <span>{actions.exportState.message}</span>
          {actions.exportState.status === "error" ? (
            <Button
              onClick={() => void exportAnnotations(actions.exportState!.format)}
              size="compact"
              variant="ghost"
            >
              Retry
            </Button>
          ) : null}
          {actions.exportState.status !== "exporting" ? (
            <IconButton
              label="Dismiss export message"
              onClick={actions.dismissExportState}
              size="compact"
            >
              <X aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      ) : null}

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
            aria-keyshortcuts={searchAriaKeyShortcuts}
            className="reader-annotations__search"
            icon={<Search aria-hidden="true" />}
            label="Search annotations"
            onChange={(event) => changeQuery(event.currentTarget.value)}
            placeholder="Search annotations"
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

      <ReaderAnnotationList
        annotationCount={annotations.length}
        bookmarkDraftLabel={actions.editing?.draftLabel ?? ""}
        currentAnnotationId={currentAnnotationId}
        currentCfi={currentCfi}
        editingAnnotationId={actions.editing?.annotationId}
        loadStatus={loadStatus}
        menuAnnotationId={actionMenu.menu?.annotation.id}
        model={listModel}
        onCancelBookmarkRename={actions.cancelBookmarkRename}
        onCancelRemoval={actions.cancelRemoval}
        onChangeBookmarkDraftLabel={actions.setBookmarkDraftLabel}
        onFocusFallback={focusPanelFallback}
        onNavigate={(annotation) => void actions.navigate(annotation)}
        onOpenMenu={actionMenu.open}
        onReload={() => void onReload()}
        onRemove={(annotation) => void actions.removeAnnotation(annotation)}
        onSaveBookmarkLabel={(annotation) => void actions.saveBookmarkLabel(annotation)}
        onShowMore={() => setRenderLimit(nextReaderAnnotationRenderLimit)}
        panelAction={actions.panelAction}
        panelId={panelId}
        pendingRemovalId={actions.pendingRemovalId}
        query={query}
        recoveryFeedback={actions.recoveryFeedback}
        ref={listRef}
        rowMutation={actions.rowMutation}
        view={view}
      />

      <ReaderAnnotationActionMenu
        busyAnnotationId={actions.rowMutation?.annotationId}
        menu={actionMenu.menu}
        menuRef={actionMenu.menuRef}
        onBeginBookmarkRename={actions.beginBookmarkRename}
        onBeginRemoval={actions.beginRemoval}
        onClose={actionMenu.close}
        onCopyDetached={(annotation) => void actions.copyDetachedAnnotation(annotation)}
        onEditNote={(annotation) => void actions.editNote(annotation)}
        onEscape={actionMenu.handleEscape}
        onNavigate={(annotation) => void actions.navigate(annotation)}
        onOpenColors={actionMenu.openColors}
        onRecolor={actions.recolorHighlight}
        onRecover={(annotation) => void actions.recoverAnnotation(annotation)}
      />

      {actions.actionError ? (
        <p className="reader-toc__error" data-tone="error" role="alert">
          {actions.actionError.message}
        </p>
      ) : null}
    </ReaderSidePanel>
  );
}
