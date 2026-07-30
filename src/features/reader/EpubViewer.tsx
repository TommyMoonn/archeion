import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
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
import { createReaderContentTheme, readerContentSettingsEqual } from "./readerTheme";
import { IconButton } from "../../components/IconButton";
import { ReaderExternalLinkDialog } from "./ReaderExternalLinkDialog";
import { ReaderFootnotePopover } from "./ReaderFootnotePopover";
import { ReaderIllustrationViewer } from "./ReaderIllustrationViewer";
import { ReaderHighlightPalette } from "./ReaderHighlightPalette";
import { ReaderContentDocumentRegistry } from "./readerContentDocumentRegistry";
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
import type { ReaderLocation } from "./readerLocation";
import type { ReaderHighlightColor } from "./readerHighlights";
import type { ResolvedReaderTheme } from "../../themes/domain";
import type { ReaderFileLease } from "./readerFileLease";

export type { ReaderTextSelection } from "./useHighlightInteractionController";

export type EpubViewerHandle = {
  navigateToChapter: (chapterId: string) => Promise<boolean>;
  navigateToLocation: (cfi: string) => Promise<boolean>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  resolveAnnotationAnchor: (
    annotation: Annotation,
    attemptRecovery: boolean,
  ) => Promise<ReaderAnnotationRecoveryResult>;
};

type EpubViewerProps = {
  fileLease: ReaderFileLease;
  highlights?: readonly HighlightAnnotation[];
  initialCfi?: string;
  onError: (message: string) => void;
  onHighlightInteractionClear?: () => void;
  onHighlightInteractionError?: (message: string) => void;
  onHighlightAnchorInvalid?: (annotationId: string, anchorSignature: string) => Promise<boolean>;
  onInteraction: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onLocationChange: (location: ReaderLocation) => void;
  onOpenNote?: (selection: ReaderTextSelection, existingHighlight?: HighlightAnnotation) => void;
  onCreateHighlight?: (
    selection: ReaderTextSelection,
    color: ReaderHighlightColor,
  ) => Promise<boolean>;
  onRecolorHighlight?: (id: string, color: ReaderHighlightColor) => Promise<boolean>;
  onRemoveHighlight?: (id: string) => Promise<boolean>;
  onNavigationChange?: (navigation: ReaderNavigationState) => void;
  onReady: () => void;
  readerTheme: ResolvedReaderTheme;
  settings: ReaderSettings;
};

function renderedSectionHref(section: unknown): string | undefined {
  if (typeof section !== "object" || section === null) return undefined;
  const href = (section as { href?: unknown }).href;
  return typeof href === "string" ? href : undefined;
}

function sessionErrorMessage(error: EpubSessionError): string {
  switch (error.kind) {
    case "open-failed":
      return "This EPUB could not be opened. Return to the Library and try another file.";
  }
}

const EpubViewerComponent = forwardRef<EpubViewerHandle, EpubViewerProps>(function EpubViewer(
  {
    fileLease,
    highlights = [],
    initialCfi,
    onError,
    onHighlightAnchorInvalid,
    onHighlightInteractionClear,
    onHighlightInteractionError,
    onInteraction,
    onKeyDown,
    onLocationChange,
    onOpenNote,
    onCreateHighlight,
    onRecolorHighlight,
    onRemoveHighlight,
    onNavigationChange,
    onReady,
    readerTheme,
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
  const clearReaderWheelGesture = useCallback(() => {
    wheelDeltaRef.current = 0;
    lastWheelEventAtRef.current = Number.NEGATIVE_INFINITY;
    lastWheelTurnAtRef.current = Number.NEGATIVE_INFINITY;
  }, []);
  const [contentDocuments] = useState(() => new ReaderContentDocumentRegistry());
  const [annotations] = useState(
    () =>
      new RenderedAnnotationAdapter({
        highlights,
        onAnchorInvalid: onHighlightAnchorInvalid,
        onCancelHighlightGesture: () => undefined,
        onHighlightEvent: () => undefined,
      }),
  );

  const contentTheme = useMemo(
    () =>
      createReaderContentTheme(
        {
          fontFamily: settings.fontFamily,
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
          margin: settings.margin,
        },
        readerTheme.tokens,
      ),
    [readerTheme, settings.fontFamily, settings.fontSize, settings.lineHeight, settings.margin],
  );

  const interaction = useHighlightInteractionController({
    containerRef,
    highlights,
    onCreateHighlight,
    onHighlightInteractionClear,
    onHighlightInteractionError,
    onInteraction,
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

  useEffect(() => {
    annotations.updateOptions({
      highlights,
      onAnchorInvalid: onHighlightAnchorInvalid,
      onCancelHighlightGesture: gestures.cancel,
      onHighlightEvent: gestures.handle,
    });
    annotations.reconcile();
  }, [annotations, gestures.cancel, gestures.handle, highlights, onHighlightAnchorInvalid]);

  const bridgeRef = useRef<EpubSessionBridge>({
    isLocationUsable: () => false,
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
    getNavigationState,
    getRendition,
    getSession,
    isLoading,
    navigateToChapter: displayChapter,
    navigateToLocation: displayLocation,
    navigateToTarget: displayTarget,
    turn,
  } = useEpubSession({
    bridgeRef,
    containerRef,
    fileLease,
    initialCfi,
    mode: settings.mode,
  });

  const contentActions = useEpubContentActionController({
    getSession,
    navigateToTarget: displayTarget,
    onInteraction,
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
      isLocationUsable: (rendition, target) =>
        contentDocuments.renditionTargetIsUsable(rendition, target),
      onContent: (content) => {
        contentDocuments.bind(content);
        if (content.document) {
          const context = contentDocuments.contextFor(content.document);
          if (context) prepareDocument(context);
        }
      },
      onDisplayed: () => {
        contentDocuments.bindMounted(containerRef.current);
        annotations.reconcile();
      },
      onError: (error) => onError(sessionErrorMessage(error)),
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
      onRendered: (section, view) => {
        contentDocuments.pruneDisconnected();
        contentDocuments.bindRenderedView(view, renderedSectionHref(section));
        for (const document of contentDocuments.list()) {
          const context = contentDocuments.contextFor(document);
          if (context) prepareDocument(context);
        }
        refreshAnchor();
        annotations.reconcile();
      },
      onSelected: handleSelection,
      onSessionCreated: (session) => {
        annotations.setSession(session);
        contentDocuments.applyTheme(session.rendition, contentTheme, containerRef.current);
      },
      onSessionEnding: () => {
        annotations.setSession(null);
        resetHighlightSession();
        resetContentActionSession();
        contentDocuments.clear();
        clearReaderWheelGesture();
      },
    };
  }, [
    annotations,
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
    refreshAnchor,
    resetContentActionSession,
    resetHighlightSession,
  ]);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (shouldIgnoreReaderWheelEvent(event)) return;

      if (settings.mode === "continuous") {
        onInteraction();
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
      onInteraction();

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
    [onInteraction, settings.mode, turn],
  );

  const handleRegisteredDocumentRemoved = useCallback(
    (document: Document) => {
      handleHighlightDocumentRemoved(document);
      handleContentActionDocumentRemoved(document);
    },
    [handleContentActionDocumentRemoved, handleHighlightDocumentRemoved],
  );

  const handleRegisteredEscape = useCallback(
    () => handleContentActionEscape() || handleHighlightEscape(),
    [handleContentActionEscape, handleHighlightEscape],
  );

  useEffect(() => {
    contentDocuments.updateOptions({
      onContentClick: handleContentClick,
      onContentKeyDown: handleContentKeyDown,
      onContentPointerDown: handleContentPointerDown,
      onDocumentRemoved: handleRegisteredDocumentRemoved,
      onEscape: handleRegisteredEscape,
      onInteraction,
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
    onInteraction,
    onKeyDown,
  ]);

  useEffect(() => {
    contentDocuments.applyTheme(getRendition(), contentTheme, containerRef.current);
    dismiss(false);
  }, [contentDocuments, contentTheme, dismiss, getRendition]);

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
    onInteraction();
  }, [
    clearContentActionFeedback,
    clearFeedback,
    dismiss,
    dismissExternal,
    dismissFootnote,
    dismissIllustration,
    onInteraction,
  ]);

  const navigateToChapter = useCallback(
    async (chapterId: string) => {
      prepareNavigation();
      return displayChapter(chapterId);
    },
    [displayChapter, prepareNavigation],
  );

  const navigateToLocation = useCallback(
    async (cfi: string) => {
      prepareNavigation();
      return displayLocation(cfi);
    },
    [displayLocation, prepareNavigation],
  );

  const handleClickZone = useCallback(
    (intent: ReaderNavigationIntent) => {
      onInteraction();
      void turn(intent);
    },
    [onInteraction, turn],
  );

  useImperativeHandle(
    ref,
    () => ({
      navigateToChapter,
      navigateToLocation,
      next: () => turn("forward"),
      previous: () => turn("backward"),
      resolveAnnotationAnchor: (annotation, attemptRecovery) =>
        annotations.resolveAnnotationAnchor(annotation, attemptRecovery),
    }),
    [annotations, navigateToChapter, navigateToLocation, turn],
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
          onMouseMove={onInteraction}
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
          onMouseMove={onInteraction}
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
          onCancel={() => dismissExternal()}
          onConfirm={confirmExternal}
          opening={externalLink.opening}
          url={externalLink.url}
        />
      ) : null}
      {illustration ? (
        <ReaderIllustrationViewer
          error={illustration.error}
          loading={illustration.loading}
          onClose={() => dismissIllustration()}
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
    previous.onInteraction === next.onInteraction &&
    previous.onKeyDown === next.onKeyDown &&
    previous.onLocationChange === next.onLocationChange &&
    previous.onOpenNote === next.onOpenNote &&
    previous.onCreateHighlight === next.onCreateHighlight &&
    previous.onRecolorHighlight === next.onRecolorHighlight &&
    previous.onRemoveHighlight === next.onRemoveHighlight &&
    previous.onNavigationChange === next.onNavigationChange &&
    previous.onReady === next.onReady &&
    previous.readerTheme === next.readerTheme &&
    previous.settings.mode === next.settings.mode &&
    readerContentSettingsEqual(previous.settings, next.settings)
  );
}

export const EpubViewer = memo(EpubViewerComponent, areEpubViewerPropsEqual);
