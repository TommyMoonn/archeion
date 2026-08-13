import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderNavigationState, ReaderSettings } from "../../types/reader";
import {
  canRunReaderWheelTurn,
  getReaderWheelDelta,
  getReaderWheelIntentFromDelta,
  READER_WHEEL_GESTURE_RESET_MS,
  shouldIgnoreReaderWheelEvent,
  type ReaderNavigationIntent,
} from "./readerNavigation";
import { forwardContinuousWheel } from "./readerContinuousScroll";
import type { ReaderContentTheme } from "./readerTheme";
import { IconButton } from "../../components/IconButton";
import { ReaderExternalLinkDialog } from "./ReaderExternalLinkDialog";
import { ReaderFootnotePopover } from "./ReaderFootnotePopover";
import { ReaderIllustrationViewer } from "./ReaderIllustrationViewer";
import { ReaderHighlightPalette } from "./ReaderHighlightPalette";
import { RenderedAnnotationAdapter } from "./RenderedAnnotationAdapter";
import {
  selectedHighlightColor,
  useHighlightInteractionController,
  type ReaderTextSelection,
} from "./useHighlightInteractionController";
import { useEpubSession, type EpubSessionBridge, type EpubSessionError } from "./useEpubSession";
import { useEpubContentActionController } from "./useEpubContentActionController";
import { useReaderIllustrationExport } from "./useReaderIllustrationExport";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import { normalizeReaderSeekPercentage, type ReaderRelocation } from "./readerLocation";
import type { ReaderSeekMapState } from "./readerSeekMap";
import type { ReaderHighlightColor } from "./readerHighlights";
import type { ResolvedReaderTheme } from "../../themes/domain";
import type { ReaderFileLease } from "./readerFileLease";
import type { ReaderSessionIdentity } from "./readerSession";
import type { ReaderNavigationHistorySnapshot } from "./readerNavigationHistory";
import { useReaderSideSurfaceDismissRequest } from "./readerSideSurfaceDismissal";
import { ReaderSearchMatchEmphasis } from "./readerSearchMatchEmphasis";
import {
  useReaderPublicationSearch,
  type ReaderPublicationSearchControllerState,
} from "./useReaderPublicationSearch";
import { useReaderDictionaryLookup } from "./useReaderDictionaryLookup";

export type { ReaderTextSelection } from "./useHighlightInteractionController";

export type ReaderSeekPreview = Readonly<{
  chapterLabel?: string;
  percentage: number;
}>;

export type EpubViewerHandle = {
  closePublicationSearch: () => void;
  getNavigationHistorySnapshot: () => ReaderNavigationHistorySnapshot;
  getPublicationSearchState: () => ReaderPublicationSearchControllerState;
  navigateBack: () => Promise<boolean>;
  navigateForward: () => Promise<boolean>;
  navigateToChapter: (chapterId: string) => Promise<boolean>;
  navigateToNavigationItem: (itemId: string) => Promise<boolean>;
  navigateToLocation: (cfi: string) => Promise<boolean>;
  navigateToPublicationSearchResult: (resultId: string) => Promise<boolean>;
  navigateToSeekPercentage: (percentage: number) => Promise<boolean>;
  navigateToSelectedPublicationSearchResult: () => Promise<boolean>;
  next: () => Promise<void>;
  nextPublicationSearchResult: () => Promise<boolean>;
  previousPublicationSearchResult: () => Promise<boolean>;
  previous: () => Promise<void>;
  resolveSeekPreview: (percentage: number) => ReaderSeekPreview | null;
  setPublicationSearchQuery: (query: string) => void;
  resolveAnnotationAnchor: (
    annotation: Annotation,
    attemptRecovery: boolean,
  ) => Promise<ReaderAnnotationRecoveryResult>;
  teardown: () => void;
};

type EpubViewerProps = {
  contentTheme: ReaderContentTheme;
  fileLease: ReaderFileLease;
  highlights?: readonly HighlightAnnotation[];
  initialCfi?: string;
  onError: (identity: ReaderSessionIdentity, error: EpubSessionError) => void;
  onHighlightInteractionClear?: () => void;
  onHighlightInteractionError?: (message: string) => void;
  onHighlightAnchorInvalid?: (annotationId: string, anchorSignature: string) => Promise<boolean>;
  onKeyDown: (event: KeyboardEvent) => void;
  onLocationChange: (relocation: ReaderRelocation) => void;
  onManageDictionaries?: (focusTarget?: HTMLElement) => void;
  onOpenNote?: (selection: ReaderTextSelection, existingHighlight?: HighlightAnnotation) => void;
  onCreateHighlight?: (
    selection: ReaderTextSelection,
    color: ReaderHighlightColor,
  ) => Promise<boolean>;
  onRecolorHighlight?: (id: string, color: ReaderHighlightColor) => Promise<boolean>;
  onRemoveHighlight?: (id: string) => Promise<boolean>;
  onNavigationChange?: (navigation: ReaderNavigationState) => void;
  onNavigationHistoryChange?: (snapshot: ReaderNavigationHistorySnapshot) => void;
  onPublicationSearchChange?: (state: ReaderPublicationSearchControllerState) => void;
  onSeekMapChange?: (state: ReaderSeekMapState) => void;
  onReady: (identity: ReaderSessionIdentity) => void;
  readerTheme: ResolvedReaderTheme;
  sessionIdentity: ReaderSessionIdentity;
  settings: ReaderSettings;
};

const EpubViewerComponent = forwardRef<EpubViewerHandle, EpubViewerProps>(function EpubViewer(
  {
    contentTheme,
    fileLease,
    highlights = [],
    initialCfi,
    onError,
    onHighlightAnchorInvalid,
    onHighlightInteractionClear,
    onHighlightInteractionError,
    onKeyDown,
    onLocationChange,
    onManageDictionaries = () => undefined,
    onOpenNote,
    onCreateHighlight,
    onRecolorHighlight,
    onRemoveHighlight,
    onNavigationChange,
    onNavigationHistoryChange,
    onPublicationSearchChange,
    onSeekMapChange,
    onReady,
    readerTheme,
    sessionIdentity,
    settings,
  },
  ref,
) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastWheelEventAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastWheelTurnAtRef = useRef(Number.NEGATIVE_INFINITY);
  const wheelDeltaRef = useRef(0);
  const illustrationWasOpenRef = useRef(false);
  const dismissTopmostSurface = useReaderSideSurfaceDismissRequest();
  const clearReaderWheelGesture = useCallback(() => {
    wheelDeltaRef.current = 0;
    lastWheelEventAtRef.current = Number.NEGATIVE_INFINITY;
    lastWheelTurnAtRef.current = Number.NEGATIVE_INFINITY;
  }, []);
  const [searchMatchEmphasis] = useState(() => new ReaderSearchMatchEmphasis());
  const [annotations] = useState(
    () =>
      new RenderedAnnotationAdapter({
        highlights,
        onAnchorInvalid: onHighlightAnchorInvalid,
        onCancelHighlightGesture: () => undefined,
        onHighlightEvent: () => undefined,
      }),
  );

  const bridgeRef = useRef<EpubSessionBridge>({
    onContent: () => undefined,
    onDisplayed: () => undefined,
    onError: () => undefined,
    onLocationChange: () => undefined,
    onNavigationChange: () => undefined,
    onReady: () => undefined,
    onRelocated: () => undefined,
    onRendered: () => undefined,
    onSelected: () => undefined,
    onSessionCreated: () => undefined,
    onSessionEnding: () => undefined,
  });

  const {
    applyContentTheme,
    documents: contentDocuments,
    getInteractionSession,
    getNavigationHistorySnapshot,
    getNavigationState,
    getSeekMapState,
    isLoading,
    navigateBack: replayBack,
    navigateForward: replayForward,
    navigateToNavigationItem: displayNavigationItem,
    navigateToLocation: displayLocation,
    navigateToTarget: displayTarget,
    searchPublication,
    subscribeNavigationHistory,
    subscribeSeekMap,
    teardown,
    turn,
  } = useEpubSession({
    bridgeRef,
    containerRef,
    fileLease,
    initialCfi,
    mode: settings.mode,
    sessionIdentity,
  });

  useEffect(() => {
    if (!onNavigationHistoryChange) return undefined;

    const publish = () => onNavigationHistoryChange(getNavigationHistorySnapshot());
    publish();
    return subscribeNavigationHistory(publish);
  }, [getNavigationHistorySnapshot, onNavigationHistoryChange, subscribeNavigationHistory]);

  useEffect(() => {
    if (!onSeekMapChange) return undefined;

    const publish = () => onSeekMapChange(getSeekMapState());
    publish();
    return subscribeSeekMap(publish);
  }, [getSeekMapState, onSeekMapChange, subscribeSeekMap]);

  const publicationSearch = useReaderPublicationSearch({
    emphasis: searchMatchEmphasis,
    navigateToTarget: displayTarget,
    searchPublication,
    sessionIdentity,
  });
  const {
    close: closePublicationSearch,
    runtimeEnding: handlePublicationSearchRuntimeEnding,
    runtimeReady: handlePublicationSearchRuntimeReady,
  } = publicationSearch;

  useEffect(() => {
    onPublicationSearchChange?.(publicationSearch.state);
  }, [onPublicationSearchChange, publicationSearch.state]);

  const interaction = useHighlightInteractionController({
    containerRef,
    highlights,
    onCreateHighlight,
    onHighlightInteractionClear,
    onHighlightInteractionError,
    onOpenNote,
    onRecolorHighlight,
    onRemoveHighlight,
    paletteRef,
    registry: contentDocuments,
    viewerRef,
  });
  const {
    busy: highlightBusy,
    choosePaletteOption,
    clearFeedback,
    dismiss,
    gestures,
    handleDocumentRemoved: handleHighlightDocumentRemoved,
    handleEscape: handleHighlightEscape,
    handlePointerDown,
    handleSelection,
    handleSelectionCollapsed,
    menu,
    openNote,
    paletteViewport,
    refreshAnchor,
    resetForSession: resetHighlightSession,
  } = interaction;
  const dictionaryLookup = useReaderDictionaryLookup({
    onManageDictionaries,
    selectionOwner: menu,
    sessionIdentity,
  });
  const defineAvailability = menu
    ? dictionaryLookup.availabilityFor(menu.selection.selectedText)
    : null;

  useEffect(() => {
    annotations.updateOptions({
      highlights,
      onAnchorInvalid: onHighlightAnchorInvalid,
      onCancelHighlightGesture: gestures.cancel,
      onHighlightEvent: gestures.handle,
    });
    annotations.reconcile();
  }, [annotations, gestures.cancel, gestures.handle, highlights, onHighlightAnchorInvalid]);

  const getContentSession = useCallback(
    () => getInteractionSession()?.content ?? null,
    [getInteractionSession],
  );

  const contentActions = useEpubContentActionController({
    getContentSession,
    navigateToTarget: displayTarget,
    registry: contentDocuments,
    viewerRef,
  });
  const {
    clearFeedback: clearContentActionFeedback,
    confirmExternal,
    dismissExternal,
    dismissFootnote,
    dismissIllustration,
    external: externalLink,
    feedback: contentActionFeedback,
    footnote,
    illustration,
    handleContentClick,
    handleContentKeyDown,
    handleContentPointerDown,
    handleDocumentRemoved: handleContentActionDocumentRemoved,
    handleEscape: handleContentActionEscape,
    handleFootnoteAction,
    prepareDocument,
    resetForSession: resetContentActionSession,
  } = contentActions;
  const illustrationExport = useReaderIllustrationExport(illustration?.resource);

  useLayoutEffect(() => {
    const illustrationIsOpen = illustration !== null;
    if (illustrationWasOpenRef.current === illustrationIsOpen) return;
    illustrationWasOpenRef.current = illustrationIsOpen;
    clearReaderWheelGesture();
  }, [clearReaderWheelGesture, illustration]);

  useEffect(() => {
    bridgeRef.current = {
      onContent: (content) => {
        if (content.document) {
          const context = contentDocuments.contextFor(content.document);
          if (context) prepareDocument(context);
        }
      },
      onDisplayed: () => {
        annotations.reconcile();
      },
      onError,
      onLocationChange,
      onNavigationChange: (navigation) => onNavigationChange?.(navigation),
      onReady,
      onRelocated: () => {
        dismiss(false);
        clearFeedback();
        dismissFootnote(false);
        dismissExternal(false);
        clearContentActionFeedback();
      },
      onRendered: () => {
        for (const document of contentDocuments.list()) {
          const context = contentDocuments.contextFor(document);
          if (context) prepareDocument(context);
        }
        refreshAnchor();
        annotations.reconcile();
      },
      onSelected: handleSelection,
      onSessionCreated: (session) => {
        annotations.setSession(session.annotations);
        searchMatchEmphasis.setSession(session.annotations);
        handlePublicationSearchRuntimeReady();
        applyContentTheme(contentTheme, containerRef.current);
      },
      onSessionEnding: (reason) => {
        if (reason === "replacement") handlePublicationSearchRuntimeEnding();
        searchMatchEmphasis.setSession(null);
        annotations.setSession(null);
        resetHighlightSession();
        resetContentActionSession();
        clearReaderWheelGesture();
      },
    };
  }, [
    annotations,
    applyContentTheme,
    clearContentActionFeedback,
    clearReaderWheelGesture,
    clearFeedback,
    contentDocuments,
    contentTheme,
    dismiss,
    dismissExternal,
    dismissFootnote,
    handleSelection,
    onError,
    onLocationChange,
    onNavigationChange,
    onReady,
    prepareDocument,
    handlePublicationSearchRuntimeEnding,
    handlePublicationSearchRuntimeReady,
    refreshAnchor,
    resetContentActionSession,
    resetHighlightSession,
    searchMatchEmphasis,
  ]);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (shouldIgnoreReaderWheelEvent(event)) return;

      if (settings.mode === "continuous") {
        forwardContinuousWheel(
          event,
          containerRef.current?.querySelector<HTMLElement>(".epub-container") ?? null,
        );
        return;
      }

      const deltaY = getReaderWheelDelta(event);
      if (deltaY === null) return;
      event.preventDefault();
      event.stopPropagation();

      const now = performance.now();
      if (now - lastWheelEventAtRef.current > READER_WHEEL_GESTURE_RESET_MS) {
        wheelDeltaRef.current = 0;
      }
      lastWheelEventAtRef.current = now;
      wheelDeltaRef.current += deltaY;
      const intent = getReaderWheelIntentFromDelta(wheelDeltaRef.current);
      if (!intent) return;

      wheelDeltaRef.current = 0;
      if (!canRunReaderWheelTurn(now, lastWheelTurnAtRef.current)) return;
      lastWheelTurnAtRef.current = now;
      void turn(intent);
    },
    [settings.mode, turn],
  );

  const handleRegisteredDocumentRemoved = useCallback(
    (document: Document) => {
      handleHighlightDocumentRemoved(document);
      handleContentActionDocumentRemoved(document);
    },
    [handleContentActionDocumentRemoved, handleHighlightDocumentRemoved],
  );

  const handleRegisteredEscape = useCallback(
    () => dismissTopmostSurface() || handleContentActionEscape() || handleHighlightEscape(),
    [dismissTopmostSurface, handleContentActionEscape, handleHighlightEscape],
  );

  useEffect(() => {
    contentDocuments.updateOptions({
      onContentClick: handleContentClick,
      onContentKeyDown: handleContentKeyDown,
      onContentPointerDown: handleContentPointerDown,
      onDocumentRemoved: handleRegisteredDocumentRemoved,
      onEscape: handleRegisteredEscape,
      onKeyDown,
      onPointerDown: handlePointerDown,
      onSelectionCollapsed: handleSelectionCollapsed,
      onWheel: handleWheel,
    });
  }, [
    contentDocuments,
    handleContentClick,
    handleContentKeyDown,
    handleContentPointerDown,
    handlePointerDown,
    handleRegisteredDocumentRemoved,
    handleRegisteredEscape,
    handleSelectionCollapsed,
    handleWheel,
    onKeyDown,
  ]);

  useEffect(() => {
    applyContentTheme(contentTheme, containerRef.current);
    dismiss(false);
  }, [applyContentTheme, contentTheme, dismiss]);

  useEffect(() => {
    onNavigationChange?.(getNavigationState());
  }, [getNavigationState, onNavigationChange]);

  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;
    const options: AddEventListenerOptions = { passive: false };
    container.addEventListener("wheel", handleWheel, options);
    return () => container.removeEventListener("wheel", handleWheel, options);
  }, [handleWheel]);

  const prepareNavigation = useCallback(() => {
    dismiss(false);
    clearFeedback();
    dismissFootnote(false);
    dismissExternal(false);
    dismissIllustration(false);
    clearContentActionFeedback();
  }, [
    clearContentActionFeedback,
    clearFeedback,
    dismiss,
    dismissExternal,
    dismissFootnote,
    dismissIllustration,
  ]);

  const navigateToNavigationItem = useCallback(
    async (itemId: string) => {
      prepareNavigation();
      return displayNavigationItem(itemId);
    },
    [displayNavigationItem, prepareNavigation],
  );
  const navigateToChapter = navigateToNavigationItem;

  const navigateToLocation = useCallback(
    async (cfi: string) => {
      prepareNavigation();
      return displayLocation(cfi);
    },
    [displayLocation, prepareNavigation],
  );

  const resolveSeekTarget = useCallback(
    (percentage: number) => {
      const normalized = normalizeReaderSeekPercentage(percentage / 100);
      const seekMap = getSeekMapState();
      if (normalized === undefined || seekMap.status !== "ready") return null;

      const cfi = seekMap.resolveCfi(normalized);
      if (!cfi) return null;

      const chapterLabel = seekMap.resolveChapterLabel(cfi);
      return {
        cfi,
        preview: Object.freeze({
          ...(chapterLabel ? { chapterLabel } : {}),
          percentage: normalized * 100,
        }) satisfies ReaderSeekPreview,
      };
    },
    [getSeekMapState],
  );

  const resolveSeekPreview = useCallback(
    (percentage: number): ReaderSeekPreview | null =>
      resolveSeekTarget(percentage)?.preview ?? null,
    [resolveSeekTarget],
  );

  const navigateToSeekPercentage = useCallback(
    async (percentage: number) => {
      const seekTarget = resolveSeekTarget(percentage);
      if (!seekTarget) return false;
      prepareNavigation();
      return displayLocation(seekTarget.cfi);
    },
    [displayLocation, prepareNavigation, resolveSeekTarget],
  );

  const navigateBack = useCallback(async () => {
    prepareNavigation();
    return replayBack();
  }, [prepareNavigation, replayBack]);

  const navigateForward = useCallback(async () => {
    prepareNavigation();
    return replayForward();
  }, [prepareNavigation, replayForward]);

  const teardownReader = useCallback(() => {
    closePublicationSearch();
    teardown();
  }, [closePublicationSearch, teardown]);

  const handleClickZone = useCallback(
    (intent: ReaderNavigationIntent) => {
      void turn(intent);
    },
    [turn],
  );

  useImperativeHandle(
    ref,
    () => ({
      closePublicationSearch,
      getNavigationHistorySnapshot,
      getPublicationSearchState: () => publicationSearch.state,
      navigateBack,
      navigateForward,
      navigateToChapter,
      navigateToNavigationItem,
      navigateToLocation,
      navigateToPublicationSearchResult: publicationSearch.navigateResult,
      navigateToSeekPercentage,
      navigateToSelectedPublicationSearchResult: publicationSearch.navigateSelectedResult,
      next: () => turn("forward"),
      nextPublicationSearchResult: publicationSearch.nextResult,
      previous: () => turn("backward"),
      previousPublicationSearchResult: publicationSearch.previousResult,
      resolveAnnotationAnchor: (annotation, attemptRecovery) =>
        annotations.resolveAnnotationAnchor(annotation, attemptRecovery),
      resolveSeekPreview,
      setPublicationSearchQuery: publicationSearch.setQuery,
      teardown: teardownReader,
    }),
    [
      annotations,
      getNavigationHistorySnapshot,
      navigateBack,
      navigateForward,
      navigateToChapter,
      navigateToNavigationItem,
      navigateToLocation,
      navigateToSeekPercentage,
      closePublicationSearch,
      publicationSearch.navigateResult,
      publicationSearch.navigateSelectedResult,
      publicationSearch.nextResult,
      publicationSearch.previousResult,
      publicationSearch.setQuery,
      publicationSearch.state,
      resolveSeekPreview,
      teardownReader,
      turn,
    ],
  );

  return (
    <div
      ref={viewerRef}
      className="epub-viewer"
      data-reader-mode={settings.mode}
      data-reader-theme={readerTheme.base}
    >
      <div ref={containerRef} className="epub-viewer__stage" />
      {settings.mode === "paged" ? (
        <button
          aria-label="Previous page"
          className="epub-viewer__click-zone epub-viewer__click-zone--previous"
          onClick={() => handleClickZone("backward")}
          style={
            {
              "--reader-page-turn-zone-width": `${Math.max(0, Math.min(settings.margin, 88))}px`,
            } as CSSProperties
          }
          tabIndex={-1}
          type="button"
        >
          <span
            aria-hidden="true"
            className="epub-viewer__click-zone-icon icon-slot icon-slot--prominent"
          >
            <ChevronLeft strokeWidth={2.25} />
          </span>
        </button>
      ) : null}
      {settings.mode === "paged" ? (
        <button
          aria-label="Next page"
          className="epub-viewer__click-zone epub-viewer__click-zone--next"
          onClick={() => handleClickZone("forward")}
          style={
            {
              "--reader-page-turn-zone-width": `${Math.max(0, Math.min(settings.margin, 88))}px`,
            } as CSSProperties
          }
          tabIndex={-1}
          type="button"
        >
          <span
            aria-hidden="true"
            className="epub-viewer__click-zone-icon icon-slot icon-slot--prominent"
          >
            <ChevronRight strokeWidth={2.25} />
          </span>
        </button>
      ) : null}
      {isLoading ? (
        <div className="reader-loading" role="status">
          <span className="reader-loading__line" />
          <span className="reader-loading__line reader-loading__line--short" />
          <span>Opening book</span>
        </div>
      ) : null}
      {footnote ? (
        <ReaderFootnotePopover
          anchorRect={footnote.anchorRect}
          content={footnote.content}
          message={footnote.message}
          onAction={handleFootnoteAction}
          onDismiss={dismissFootnote}
          viewportRect={footnote.viewportRect}
        />
      ) : null}
      {externalLink ? (
        <ReaderExternalLinkDialog
          error={externalLink.error}
          host={externalLink.host}
          onCancel={dismissExternal}
          onConfirm={confirmExternal}
          opening={externalLink.opening}
          url={externalLink.url}
        />
      ) : null}
      {illustration ? (
        <ReaderIllustrationViewer
          error={illustration.error}
          loading={illustration.loading}
          onClose={dismissIllustration}
          onSaveImage={() => void illustrationExport.save()}
          resource={illustration.resource}
          saveState={illustrationExport.state}
        />
      ) : null}
      {contentActionFeedback ? (
        <div className="reader-content-action-feedback" data-tone="error" role="status">
          <span>{contentActionFeedback}</span>
          <IconButton
            label="Dismiss link message"
            onClick={clearContentActionFeedback}
            size="compact"
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}
      {menu ? (
        <ReaderHighlightPalette
          ref={paletteRef}
          anchorRect={menu.anchorRect}
          busy={highlightBusy}
          defineAvailable={Boolean(defineAvailability?.available)}
          defineBusy={dictionaryLookup.state.status === "looking-up"}
          defineLabel={defineAvailability?.label ?? "Define"}
          defineUnavailableReason={defineAvailability?.reason ?? undefined}
          hasAttachedNote={Boolean(menu.existingHighlight?.note?.trim())}
          noteActionLabel={
            menu.existingHighlight
              ? menu.existingHighlight.note?.trim()
                ? "Edit note"
                : "Add note"
              : "Highlight and add note"
          }
          onChoose={choosePaletteOption}
          onDismiss={dismiss}
          onDefine={() => dictionaryLookup.define(menu)}
          onNote={openNote}
          selectedColor={selectedHighlightColor(menu)}
          viewportRect={paletteViewport}
        />
      ) : null}
    </div>
  );
});

function areEpubViewerPropsEqual(previous: EpubViewerProps, next: EpubViewerProps): boolean {
  return (
    previous.fileLease === next.fileLease &&
    previous.highlights === next.highlights &&
    previous.initialCfi === next.initialCfi &&
    previous.onError === next.onError &&
    previous.onHighlightAnchorInvalid === next.onHighlightAnchorInvalid &&
    previous.onHighlightInteractionClear === next.onHighlightInteractionClear &&
    previous.onHighlightInteractionError === next.onHighlightInteractionError &&
    previous.onKeyDown === next.onKeyDown &&
    previous.onLocationChange === next.onLocationChange &&
    previous.onManageDictionaries === next.onManageDictionaries &&
    previous.onOpenNote === next.onOpenNote &&
    previous.onCreateHighlight === next.onCreateHighlight &&
    previous.onRecolorHighlight === next.onRecolorHighlight &&
    previous.onRemoveHighlight === next.onRemoveHighlight &&
    previous.onNavigationChange === next.onNavigationChange &&
    previous.onPublicationSearchChange === next.onPublicationSearchChange &&
    previous.onSeekMapChange === next.onSeekMapChange &&
    previous.onReady === next.onReady &&
    previous.contentTheme === next.contentTheme &&
    previous.readerTheme === next.readerTheme &&
    previous.sessionIdentity === next.sessionIdentity &&
    previous.settings.margin === next.settings.margin &&
    previous.settings.mode === next.settings.mode
  );
}

export const EpubViewer = memo(EpubViewerComponent, areEpubViewerPropsEqual);
