import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { HighlightAnnotation } from "../../types/annotation";
import {
  createHighlightActivationGestureController,
  resolveHighlightSelection,
  type HighlightActivation,
  type HighlightActivationGestureController,
} from "./readerHighlightInteraction";
import {
  directHighlightPaletteAnchor,
  selectionPaletteAnchor,
  type ClientRect,
} from "./readerHighlightPaletteAnchor";
import { readerSelectionContext } from "./readerAnnotationRecovery";
import type { HighlightPaletteChoice } from "./ReaderHighlightPalette";
import type { EpubContent, ReaderContentDocumentAccess } from "./readerContentDocumentRegistry";
import { normalizeReaderHighlightColor, type ReaderHighlightColor } from "./readerHighlights";
import {
  useHighlightPaletteController,
  type HighlightInteractionMenu,
  type ReaderTextSelection,
} from "./useHighlightPaletteController";

export type {
  HighlightInteractionMenu,
  ReaderTextSelection,
} from "./useHighlightPaletteController";

type HighlightInteractionCallbacks = {
  onCreateHighlight?: (
    selection: ReaderTextSelection,
    color: ReaderHighlightColor,
  ) => Promise<boolean>;
  onHighlightInteractionClear?: () => void;
  onHighlightInteractionError?: (message: string) => void;
  onInteraction: () => void;
  onOpenNote?: (selection: ReaderTextSelection, existingHighlight?: HighlightAnnotation) => void;
  onRecolorHighlight?: (id: string, color: ReaderHighlightColor) => Promise<boolean>;
  onRemoveHighlight?: (id: string) => Promise<boolean>;
};

export type UseHighlightInteractionOptions = HighlightInteractionCallbacks & {
  containerRef: RefObject<HTMLDivElement | null>;
  highlights: readonly HighlightAnnotation[];
  paletteRef: RefObject<HTMLDivElement | null>;
  registry: ReaderContentDocumentAccess;
  viewerRef: RefObject<HTMLDivElement | null>;
};

export type HighlightInteractionController = {
  busy: boolean;
  choosePaletteOption: (choice: HighlightPaletteChoice) => void;
  clearFeedback: (document?: Document) => void;
  dismiss: (restoreFocus?: boolean) => void;
  gestures: HighlightActivationGestureController;
  handleDocumentRemoved: (document: Document) => void;
  handleEscape: () => boolean;
  handlePointerDown: () => void;
  handleSelection: (cfiRange: string, contents: EpubContent) => void;
  handleSelectionCollapsed: (document: Document) => void;
  menu: HighlightInteractionMenu | null;
  openNote: () => void;
  paletteViewport: ClientRect;
  refreshAnchor: () => void;
  resetForSession: () => void;
};

export function useHighlightInteractionController({
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
  registry,
  viewerRef,
}: UseHighlightInteractionOptions): HighlightInteractionController {
  const callbacksRef = useRef<HighlightInteractionCallbacks>({
    onCreateHighlight,
    onHighlightInteractionClear,
    onHighlightInteractionError,
    onInteraction,
    onOpenNote,
    onRecolorHighlight,
    onRemoveHighlight,
  });
  const feedbackDocumentRef = useRef<Document | null>(null);
  const highlightsByIdRef = useRef(
    new Map(highlights.map((highlight) => [highlight.id, highlight])),
  );
  const operationRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const gestureControllerRef = useRef<HighlightActivationGestureController | null>(null);
  const [busy, setBusy] = useState(false);
  const [gestures] = useState<HighlightActivationGestureController>(() => ({
    cancel: (annotationId) => gestureControllerRef.current?.cancel(annotationId),
    cancelAll: () => gestureControllerRef.current?.cancelAll(),
    cancelDocument: (document) => gestureControllerRef.current?.cancelDocument(document),
    handle: (annotationId, event) => gestureControllerRef.current?.handle(annotationId, event),
  }));

  useEffect(() => {
    callbacksRef.current = {
      onCreateHighlight,
      onHighlightInteractionClear,
      onHighlightInteractionError,
      onInteraction,
      onOpenNote,
      onRecolorHighlight,
      onRemoveHighlight,
    };
  }, [
    onCreateHighlight,
    onHighlightInteractionClear,
    onHighlightInteractionError,
    onInteraction,
    onOpenNote,
    onRecolorHighlight,
    onRemoveHighlight,
  ]);

  useEffect(() => {
    highlightsByIdRef.current = new Map(highlights.map((highlight) => [highlight.id, highlight]));
  }, [highlights]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      busyRef.current = false;
      operationRef.current += 1;
    };
  }, []);

  const cancelOperation = useCallback(() => {
    operationRef.current += 1;
    busyRef.current = false;
    setBusy(false);
  }, []);

  const {
    dismiss,
    getCurrent,
    handleDocumentRemoved: dismissForRemovedDocument,
    handleEscape,
    handlePointerDown,
    handleSelectionCollapsed: dismissForCollapsedSelection,
    menu,
    open: openPalette,
    paletteViewport,
    refreshAnchor,
  } = useHighlightPaletteController({
    containerRef,
    onDismiss: cancelOperation,
    paletteRef,
    registry,
    viewerRef,
  });

  const clearFeedback = useCallback((document?: Document) => {
    const owner = feedbackDocumentRef.current;
    if (document && owner && owner !== document) return;
    feedbackDocumentRef.current = null;
    callbacksRef.current.onHighlightInteractionClear?.();
  }, []);

  const reportFeedback = useCallback((message: string, document: Document) => {
    feedbackDocumentRef.current = document;
    callbacksRef.current.onHighlightInteractionError?.(message);
  }, []);

  const activateHighlight = useCallback(
    ({ annotationId, target }: HighlightActivation) => {
      const highlight = highlightsByIdRef.current.get(annotationId);
      if (!highlight) return;
      const anchor = directHighlightPaletteAnchor(target, highlight.cfiRange, registry.list());
      const anchorRect = anchor?.resolveRect();
      if (!anchor || !anchorRect) return;

      clearFeedback();
      cancelOperation();
      openPalette({
        anchor,
        anchorRect,
        existingHighlight: highlight,
        selection: {
          cfiRange: highlight.cfiRange,
          chapterHref: highlight.chapterHref,
          contextAfter: highlight.contextAfter,
          contextBefore: highlight.contextBefore,
          selectedText: highlight.selectedText,
        },
      });
      callbacksRef.current.onInteraction();
    },
    [cancelOperation, clearFeedback, openPalette, registry],
  );

  useEffect(() => {
    const controller = createHighlightActivationGestureController(activateHighlight);
    gestureControllerRef.current = controller;
    return () => {
      controller.cancelAll();
      if (gestureControllerRef.current === controller) gestureControllerRef.current = null;
    };
  }, [activateHighlight]);

  const handleSelection = useCallback(
    (cfiRange: string, contents: EpubContent) => {
      const selection = contents.window?.getSelection();
      const selectedText = selection?.toString().trim() ?? "";
      if (!selection || !selectedText || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const sourceDocument = contents.document ?? range.startContainer.ownerDocument;
      if (!sourceDocument) return;
      const anchor = selectionPaletteAnchor(range, sourceDocument);
      const anchorRect = anchor.resolveRect();
      if (!anchorRect) return;

      const resolution = resolveHighlightSelection(cfiRange, [
        ...highlightsByIdRef.current.values(),
      ]);
      if (resolution.kind === "blocked") {
        dismiss(false);
        reportFeedback("Overlapping highlights cannot be edited together.", sourceDocument);
        callbacksRef.current.onInteraction();
        return;
      }

      clearFeedback(sourceDocument);
      cancelOperation();
      openPalette({
        anchor,
        anchorRect,
        existingHighlight: resolution.kind === "existing" ? resolution.highlight : undefined,
        selection: {
          cfiRange,
          chapterHref: contents.section?.href,
          ...readerSelectionContext(range),
          selectedText,
        },
      });
      callbacksRef.current.onInteraction();
    },
    [cancelOperation, clearFeedback, dismiss, openPalette, reportFeedback],
  );

  const handleDocumentRemoved = useCallback(
    (document: Document) => {
      gestures.cancelDocument(document);
      dismissForRemovedDocument(document);
      clearFeedback(document);
    },
    [clearFeedback, dismissForRemovedDocument, gestures],
  );

  const handleSelectionCollapsed = useCallback(
    (document: Document) => {
      dismissForCollapsedSelection(document);
      clearFeedback(document);
    },
    [clearFeedback, dismissForCollapsedSelection],
  );

  const resetForSession = useCallback(() => {
    gestures.cancelAll();
    dismiss(false);
    clearFeedback();
  }, [clearFeedback, dismiss, gestures]);

  const runIntent = useCallback(
    async (intent: (owner: HighlightInteractionMenu) => Promise<boolean | undefined>) => {
      const owner = getCurrent();
      if (!owner || busyRef.current) return;
      const operation = ++operationRef.current;
      busyRef.current = true;
      setBusy(true);
      let succeeded = false;
      try {
        succeeded = Boolean(await intent(owner));
      } catch {
        if (mountedRef.current && operation === operationRef.current) {
          callbacksRef.current.onHighlightInteractionError?.(
            "The highlight change could not be saved.",
          );
        }
      } finally {
        if (mountedRef.current && operation === operationRef.current && getCurrent() === owner) {
          busyRef.current = false;
          setBusy(false);
          if (succeeded) {
            registry.clearSelection(owner.anchor.document);
            dismiss(false);
          }
        }
      }
    },
    [dismiss, getCurrent, registry],
  );

  const choosePaletteOption = useCallback(
    (choice: HighlightPaletteChoice) => {
      const current = getCurrent();
      if (!current) return;
      if (choice === "none") {
        if (current.existingHighlight) {
          void runIntent(
            (owner) =>
              callbacksRef.current.onRemoveHighlight?.(owner.existingHighlight!.id) ??
              Promise.resolve(false),
          );
        } else {
          registry.clearSelection(current.anchor.document);
          dismiss(false);
        }
        return;
      }

      void runIntent((owner) =>
        owner.existingHighlight
          ? (callbacksRef.current.onRecolorHighlight?.(owner.existingHighlight.id, choice) ??
            Promise.resolve(false))
          : (callbacksRef.current.onCreateHighlight?.(owner.selection, choice) ??
            Promise.resolve(false)),
      );
    },
    [dismiss, getCurrent, registry, runIntent],
  );

  const openNote = useCallback(() => {
    const current = getCurrent();
    if (!current) return;
    callbacksRef.current.onOpenNote?.(current.selection, current.existingHighlight);
    registry.clearSelection(current.anchor.document);
    dismiss(false);
  }, [dismiss, getCurrent, registry]);

  return {
    busy,
    choosePaletteOption,
    clearFeedback,
    dismiss,
    gestures,
    handleDocumentRemoved,
    handleEscape,
    handlePointerDown,
    handleSelection,
    handleSelectionCollapsed,
    menu,
    openNote,
    paletteViewport,
    refreshAnchor,
    resetForSession,
  };
}

export function selectedHighlightColor(menu: HighlightInteractionMenu | null) {
  return menu?.existingHighlight
    ? normalizeReaderHighlightColor(menu.existingHighlight.color)
    : undefined;
}
