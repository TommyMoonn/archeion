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
import type { Book as EpubBook, Location, Rendition } from "epubjs";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

import type { ReaderNavigationState, ReaderSettings } from "../../types/reader";
import type { HighlightAnnotation } from "../../types/annotation";
import {
  canRunReaderWheelTurn,
  getReaderWheelDelta,
  getReaderWheelIntentFromDelta,
  READER_WHEEL_GESTURE_RESET_MS,
  type ReaderNavigationIntent,
} from "./readerNavigation";
import { normalizeReaderLocation, type ReaderLocation } from "./readerLocation";
import {
  forwardContinuousWheel,
  stabilizeContinuousRendition,
  type RenditionWithManager,
} from "./readerContinuousScroll";
import { loadReaderNavigationModel } from "./readerNavigationModel";
import { createReaderNavigationStateController } from "./readerNavigationState";
import {
  applyReaderContentTheme,
  createReaderContentTheme,
  readerContentSettingsEqual,
} from "./readerTheme";
import {
  normalizeReaderHighlightColor,
  readerHighlightStyles,
  type ReaderHighlightColor,
} from "./readerHighlights";
import { ReaderHighlightPalette, type HighlightPaletteChoice } from "./ReaderHighlightPalette";
import {
  createHighlightActivationGestureController,
  resolveHighlightSelection,
} from "./readerHighlightInteraction";
import {
  directHighlightPaletteAnchor,
  normalizeClientRect,
  selectionPaletteAnchor,
  type ClientRect,
  type HighlightPaletteAnchor,
} from "./readerHighlightPaletteAnchor";

export type EpubViewerHandle = {
  navigateToChapter: (chapterId: string) => Promise<boolean>;
  navigateToLocation: (cfi: string) => Promise<boolean>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
};

export type ReaderTextSelection = {
  cfiRange: string;
  chapterHref?: string;
  selectedText: string;
};

type EpubViewerProps = {
  fileBlob: Blob;
  highlights?: readonly HighlightAnnotation[];
  initialCfi?: string;
  onError: (message: string) => void;
  onHighlightInteractionClear?: () => void;
  onHighlightInteractionError?: (message: string) => void;
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
  settings: ReaderSettings;
};

type EpubViewerCallbacks = Pick<
  EpubViewerProps,
  | "onError"
  | "onHighlightInteractionClear"
  | "onHighlightInteractionError"
  | "onInteraction"
  | "onKeyDown"
  | "onLocationChange"
  | "onNavigationChange"
  | "onReady"
>;

type RenderedView = {
  document?: Document;
  iframe?: HTMLIFrameElement;
  contents?: {
    document?: Document;
    window?: Window;
  };
};

type EpubContent = {
  document?: Document;
  section?: { href?: string };
  window?: Window;
};

type HighlightMenu = {
  anchor: HighlightPaletteAnchor;
  anchorRect: ClientRect;
  existingHighlight?: HighlightAnnotation;
  selection: ReaderTextSelection;
};

type RenditionWithContentHook = Rendition & {
  hooks?: {
    content?: {
      register?: (callback: (contents: EpubContent) => void) => void;
    };
  };
};

function documentFromRenderedView(view: unknown) {
  const renderedView = view as RenderedView | null;

  return (
    renderedView?.document ??
    renderedView?.contents?.document ??
    renderedView?.iframe?.contentDocument ??
    null
  );
}

function windowFromContentDocument(document: Document | null) {
  return document?.defaultView ?? null;
}

function renditionTargetIsUsable(
  rendition: Rendition,
  target: string,
  contentDocuments: ReadonlySet<Document>,
): boolean {
  if (typeof rendition.getRange !== "function") return true;
  try {
    const range = rendition.getRange(target, "archeion-highlight");
    const document = range?.startContainer.ownerDocument;
    const frame = document?.defaultView?.frameElement;
    return Boolean(document && contentDocuments.has(document) && frame?.isConnected);
  } catch {
    return false;
  }
}

const EpubViewerComponent = forwardRef<EpubViewerHandle, EpubViewerProps>(function EpubViewer(
  {
    fileBlob,
    highlights = [],
    initialCfi,
    onError,
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
    settings,
  },
  ref,
) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const highlightMenuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentCleanupRef = useRef(new Map<Document, () => void>());
  const callbacksRef = useRef<EpubViewerCallbacks>({
    onError,
    onHighlightInteractionClear,
    onHighlightInteractionError,
    onInteraction,
    onKeyDown,
    onLocationChange,
    onNavigationChange,
    onReady,
  });
  const renditionRef = useRef<Rendition | null>(null);
  const highlightsRef = useRef(highlights);
  const interactionFeedbackDocumentRef = useRef<Document | null>(null);
  const renderedHighlightsRef = useRef(
    new Map<
      string,
      { annotationId: string; color: ReaderHighlightColor; token: { active: boolean } }
    >(),
  );
  const [navigationController] = useState(() =>
    createReaderNavigationStateController((state) =>
      callbacksRef.current.onNavigationChange?.(state),
    ),
  );
  const isNavigatingToChapterRef = useRef(false);
  const isTurningPageRef = useRef(false);
  const lastWheelEventAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastWheelTurnAtRef = useRef(Number.NEGATIVE_INFINITY);
  const wheelDeltaRef = useRef(0);
  const canonicalCfiRef = useRef(initialCfi);
  const canonicalCfiFileRef = useRef<Blob | null>(null);
  const { fontFamily, fontSize, lineHeight, margin, mode, theme } = settings;
  const contentTheme = useMemo(
    () =>
      createReaderContentTheme({
        fontFamily,
        fontSize,
        lineHeight,
        margin,
        theme,
      }),
    [fontFamily, fontSize, lineHeight, margin, theme],
  );
  const contentThemeRef = useRef(contentTheme);
  const [isLoading, setIsLoading] = useState(true);
  const [highlightMenu, setHighlightMenu] = useState<HighlightMenu | null>(null);
  const [highlightBusy, setHighlightBusy] = useState(false);
  const highlightMenuStateRef = useRef<HighlightMenu | null>(null);

  callbacksRef.current = {
    onError,
    onHighlightInteractionClear,
    onHighlightInteractionError,
    onInteraction,
    onKeyDown,
    onLocationChange,
    onNavigationChange,
    onReady,
  };
  contentThemeRef.current = contentTheme;
  highlightsRef.current = highlights;
  highlightMenuStateRef.current = highlightMenu;
  const highlightMenuAnchor = highlightMenu?.anchor;

  useEffect(() => {
    if (highlightMenuAnchor) {
      window.requestAnimationFrame(() =>
        highlightMenuRef.current?.querySelector("button")?.focus(),
      );
    }
  }, [highlightMenuAnchor]);

  const clearHighlightInteractionFeedback = useCallback((document?: Document) => {
    const owner = interactionFeedbackDocumentRef.current;
    if (document && owner && owner !== document) return;
    interactionFeedbackDocumentRef.current = null;
    callbacksRef.current.onHighlightInteractionClear?.();
  }, []);

  const reportHighlightInteractionFeedback = useCallback((message: string, document: Document) => {
    interactionFeedbackDocumentRef.current = document;
    callbacksRef.current.onHighlightInteractionError?.(message);
  }, []);

  const dismissHighlightMenu = useCallback((restoreFocus = true) => {
    const focusTarget = restoreFocus
      ? highlightMenuStateRef.current?.anchor.focusTarget
      : undefined;
    setHighlightMenu(null);
    if (focusTarget?.isConnected) {
      window.requestAnimationFrame(() => focusTarget.focus());
    }
  }, []);

  const dismissHighlightMenuForDocument = useCallback((document: Document) => {
    setHighlightMenu((current) => (current?.anchor.document === document ? null : current));
  }, []);

  const highlightGestures = useMemo(
    () =>
      createHighlightActivationGestureController(({ annotationId, target }) => {
        const highlight = highlightsRef.current.find((candidate) => candidate.id === annotationId);
        if (!highlight) return;
        const anchor = directHighlightPaletteAnchor(target, highlight.cfiRange, [
          ...contentCleanupRef.current.keys(),
        ]);
        const anchorRect = anchor?.resolveRect();
        if (!anchor || !anchorRect) return;
        clearHighlightInteractionFeedback();
        setHighlightMenu({
          anchor,
          anchorRect,
          existingHighlight: highlight,
          selection: {
            cfiRange: highlight.cfiRange,
            chapterHref: highlight.chapterHref,
            selectedText: highlight.selectedText,
          },
        });
        callbacksRef.current.onInteraction();
      }),
    [clearHighlightInteractionFeedback],
  );

  const removeContentDocument = useCallback(
    (document: Document) => {
      highlightGestures.cancelDocument(document);
      contentCleanupRef.current.get(document)?.();
      contentCleanupRef.current.delete(document);
      dismissHighlightMenuForDocument(document);
      clearHighlightInteractionFeedback(document);
    },
    [clearHighlightInteractionFeedback, dismissHighlightMenuForDocument, highlightGestures],
  );

  const pruneDisconnectedContent = useCallback(() => {
    for (const document of contentCleanupRef.current.keys()) {
      if (document.defaultView?.frameElement?.isConnected) continue;
      removeContentDocument(document);
    }
  }, [removeContentDocument]);

  useEffect(() => {
    if (!highlightMenuAnchor) return;

    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !highlightMenuRef.current?.contains(event.target)) {
        dismissHighlightMenu(false);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissHighlightMenu();
    };

    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [dismissHighlightMenu, highlightMenuAnchor]);

  useLayoutEffect(() => {
    if (!highlightMenuAnchor) return;
    const refresh = () => {
      pruneDisconnectedContent();
      const anchorRect = highlightMenuAnchor.resolveRect();
      if (!anchorRect || !viewerRef.current?.isConnected) {
        dismissHighlightMenu(false);
        return;
      }
      setHighlightMenu((current) =>
        current?.anchor === highlightMenuAnchor ? { ...current, anchorRect } : current,
      );
    };
    const sourceWindow = highlightMenuAnchor.document.defaultView;
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(refresh);
    if (viewerRef.current) observer?.observe(viewerRef.current);
    let frame = sourceWindow?.frameElement;
    while (frame) {
      observer?.observe(frame);
      frame = frame.ownerDocument.defaultView?.frameElement ?? null;
    }
    const mutations =
      typeof MutationObserver === "undefined" || !containerRef.current
        ? undefined
        : new MutationObserver(refresh);
    if (containerRef.current) {
      mutations?.observe(containerRef.current, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }
    const onPageHide = () => dismissHighlightMenu(false);
    window.addEventListener("resize", refresh);
    document.addEventListener("scroll", refresh, true);
    highlightMenuAnchor.document.addEventListener("scroll", refresh, true);
    sourceWindow?.addEventListener("pagehide", onPageHide);
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", refresh);
      document.removeEventListener("scroll", refresh, true);
      highlightMenuAnchor.document.removeEventListener("scroll", refresh, true);
      sourceWindow?.removeEventListener("pagehide", onPageHide);
    };
  }, [dismissHighlightMenu, highlightMenuAnchor, pruneDisconnectedContent]);

  const reconcileHighlights = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const desired = new Map<
      string,
      { annotation: HighlightAnnotation; color: ReaderHighlightColor }
    >();
    for (const highlight of highlightsRef.current) {
      const range = highlight.cfiRange?.trim();
      if (!range || desired.has(range)) continue;
      desired.set(range, {
        annotation: highlight,
        color: normalizeReaderHighlightColor(highlight.color),
      });
    }

    for (const [range, rendered] of renderedHighlightsRef.current) {
      const next = desired.get(range);
      if (!next || next.color !== rendered.color || next.annotation.id !== rendered.annotationId) {
        rendered.token.active = false;
        highlightGestures.cancel(rendered.annotationId);
        rendition.annotations.remove(range, "highlight");
      }
    }

    const nextRendered = new Map<
      string,
      { annotationId: string; color: ReaderHighlightColor; token: { active: boolean } }
    >();
    for (const [range, { annotation: highlight, color }] of desired) {
      const rendered = renderedHighlightsRef.current.get(range);
      if (rendered?.color === color && rendered.annotationId === highlight.id) {
        nextRendered.set(range, rendered);
        continue;
      }
      const token = { active: true };
      rendition.annotations.highlight(
        range,
        { annotationId: highlight.id },
        (event: Event) => {
          const current = renderedHighlightsRef.current.get(range);
          if (!token.active || current?.token !== token) return;
          highlightGestures.handle(highlight.id, event);
        },
        "archeion-highlight",
        readerHighlightStyles(color),
      );
      nextRendered.set(range, { annotationId: highlight.id, color, token });
    }
    renderedHighlightsRef.current = nextRendered;
  }, [highlightGestures]);

  const runPageTurn = useCallback(async (intent: ReaderNavigationIntent) => {
    const rendition = renditionRef.current;

    if (!rendition || isTurningPageRef.current) {
      return;
    }

    isTurningPageRef.current = true;

    try {
      if (intent === "forward") {
        await rendition.next();
      } else {
        await rendition.prev();
      }
    } finally {
      window.setTimeout(() => {
        isTurningPageRef.current = false;
      }, 80);
    }
  }, []);

  const navigateToChapter = useCallback(
    async (chapterId: string) => {
      const rendition = renditionRef.current;
      const target = navigationController.getModel().resolveChapterTarget(chapterId);

      if (!rendition || !target || isNavigatingToChapterRef.current) {
        return false;
      }

      isNavigatingToChapterRef.current = true;
      setHighlightMenu(null);
      clearHighlightInteractionFeedback();
      callbacksRef.current.onInteraction();

      try {
        await rendition.display(target);
        return true;
      } catch {
        return false;
      } finally {
        isNavigatingToChapterRef.current = false;
      }
    },
    [clearHighlightInteractionFeedback, navigationController],
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (mode === "continuous") {
        callbacksRef.current.onInteraction();
        forwardContinuousWheel(
          event,
          containerRef.current?.querySelector<HTMLElement>(".epub-container") ?? null,
        );
        return;
      }

      const deltaY = getReaderWheelDelta(event);

      if (deltaY === null) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      callbacksRef.current.onInteraction();

      const now = performance.now();

      if (now - lastWheelEventAtRef.current > READER_WHEEL_GESTURE_RESET_MS) {
        wheelDeltaRef.current = 0;
      }

      lastWheelEventAtRef.current = now;
      wheelDeltaRef.current += deltaY;

      const intent = getReaderWheelIntentFromDelta(wheelDeltaRef.current);

      if (!intent) {
        return;
      }

      wheelDeltaRef.current = 0;

      if (!canRunReaderWheelTurn(now, lastWheelTurnAtRef.current)) {
        return;
      }

      lastWheelTurnAtRef.current = now;
      void runPageTurn(intent);
    },
    [mode, runPageTurn],
  );

  const handleClickZone = useCallback(
    (intent: ReaderNavigationIntent) => {
      callbacksRef.current.onInteraction();
      void runPageTurn(intent);
    },
    [runPageTurn],
  );

  const navigateToLocation = useCallback(
    async (cfi: string) => {
      const rendition = renditionRef.current;
      const target = cfi.trim();
      if (!rendition || !target || isNavigatingToChapterRef.current) {
        return false;
      }

      isNavigatingToChapterRef.current = true;
      setHighlightMenu(null);
      clearHighlightInteractionFeedback();
      callbacksRef.current.onInteraction();
      try {
        await rendition.display(target);
        if (
          !renditionTargetIsUsable(rendition, target, new Set(contentCleanupRef.current.keys()))
        ) {
          return false;
        }
        reconcileHighlights();
        return true;
      } catch {
        return false;
      } finally {
        isNavigatingToChapterRef.current = false;
      }
    },
    [clearHighlightInteractionFeedback, reconcileHighlights],
  );

  useImperativeHandle(
    ref,
    () => ({
      navigateToChapter,
      navigateToLocation,
      next: () => runPageTurn("forward"),
      previous: () => runPageTurn("backward"),
    }),
    [navigateToChapter, navigateToLocation, runPageTurn],
  );

  useEffect(() => {
    onNavigationChange?.(navigationController.getState());
  }, [navigationController, onNavigationChange]);

  useEffect(() => {
    const container = viewerRef.current;

    if (!container) {
      return;
    }

    const options: AddEventListenerOptions = { passive: false };
    container.addEventListener("wheel", handleWheel, options);

    return () => {
      container.removeEventListener("wheel", handleWheel, options);
    };
  }, [handleWheel]);

  useEffect(() => {
    let cancelled = false;
    let epubBook: EpubBook | null = null;
    let rendition: Rendition | null = null;
    let cancelDeferredNavigation: () => void = () => undefined;
    const displayCfi =
      canonicalCfiFileRef.current === fileBlob ? canonicalCfiRef.current : initialCfi;
    canonicalCfiFileRef.current = fileBlob;
    canonicalCfiRef.current = displayCfi;

    isNavigatingToChapterRef.current = false;
    navigationController.reset();

    async function loadNavigation(book: EpubBook) {
      const model = await loadReaderNavigationModel(book);

      if (cancelled) {
        return;
      }

      navigationController.setModel(model);
    }

    function deferNavigationLoad(book: EpubBook) {
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void;
        requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      };

      if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
        const idleId = idleWindow.requestIdleCallback(() => void loadNavigation(book), {
          timeout: 1000,
        });
        cancelDeferredNavigation = () => idleWindow.cancelIdleCallback?.(idleId);
        return;
      }

      const timeoutId = window.setTimeout(() => void loadNavigation(book), 0);
      cancelDeferredNavigation = () => window.clearTimeout(timeoutId);
    }

    function removeContentListeners() {
      highlightGestures.cancelAll();
      for (const cleanup of contentCleanupRef.current.values()) {
        cleanup();
      }
      contentCleanupRef.current.clear();
    }

    function bindContent(content: EpubContent | null) {
      const document = content?.document ?? null;

      if (!document || contentCleanupRef.current.has(document)) {
        return;
      }

      applyReaderContentTheme(null, contentThemeRef.current, [document]);
      const contentWindow = content?.window ?? windowFromContentDocument(document);

      const wheelOptions: AddEventListenerOptions = {
        capture: true,
        passive: false,
      };
      const keyOptions: AddEventListenerOptions = { capture: true };
      const onContentKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && highlightMenuStateRef.current) {
          event.preventDefault();
          event.stopPropagation();
          dismissHighlightMenu();
          return;
        }
        callbacksRef.current.onKeyDown(event);
      };
      const onContentInteraction = () => {
        callbacksRef.current.onInteraction();
      };
      const onContentPointerDown = () => {
        dismissHighlightMenu(false);
      };
      const onContentTeardown = () => {
        removeContentDocument(document);
      };
      const onSelectionChange = () => {
        if (document.getSelection()?.isCollapsed) {
          dismissHighlightMenuForDocument(document);
          clearHighlightInteractionFeedback(document);
        }
      };
      const onContentWheel: EventListener = (event) => {
        handleWheel(event as WheelEvent);
      };

      const wheelTargets: Array<Window | Document> = contentWindow
        ? [contentWindow, document]
        : [document];

      for (const target of wheelTargets) {
        target.addEventListener("wheel", onContentWheel, wheelOptions);
      }

      document.addEventListener("keydown", onContentKeyDown, keyOptions);
      document.addEventListener("pointerdown", onContentPointerDown, true);
      document.addEventListener("selectionchange", onSelectionChange);
      document.addEventListener("mousemove", onContentInteraction);
      document.addEventListener("touchstart", onContentInteraction);
      document.addEventListener("click", onContentInteraction);
      contentWindow?.addEventListener("pagehide", onContentTeardown);

      const cleanupFunctions = [
        ...wheelTargets.map(
          (target) => () => target.removeEventListener("wheel", onContentWheel, wheelOptions),
        ),
        () => document.removeEventListener("keydown", onContentKeyDown, keyOptions),
        () => document.removeEventListener("pointerdown", onContentPointerDown, true),
        () => document.removeEventListener("selectionchange", onSelectionChange),
        () => document.removeEventListener("mousemove", onContentInteraction),
        () => document.removeEventListener("touchstart", onContentInteraction),
        () => document.removeEventListener("click", onContentInteraction),
        () => contentWindow?.removeEventListener("pagehide", onContentTeardown),
      ];
      contentCleanupRef.current.set(document, () => {
        for (const cleanup of cleanupFunctions) {
          cleanup();
        }
      });
    }

    function bindMountedContentDocuments() {
      for (const frame of containerRef.current?.querySelectorAll("iframe") ?? []) {
        bindContent({
          document: frame.contentDocument ?? undefined,
          window: frame.contentWindow ?? undefined,
        });
      }
      reconcileHighlights();
    }

    async function openBook() {
      setIsLoading(true);

      try {
        const [{ default: ePub }, fileContents] = await Promise.all([
          import("epubjs"),
          fileBlob.arrayBuffer(),
        ]);

        if (cancelled || !containerRef.current) {
          return;
        }

        epubBook = ePub(fileContents);
        await epubBook.opened;

        if (cancelled || !containerRef.current) {
          epubBook.destroy();
          epubBook = null;
          return;
        }

        rendition = epubBook.renderTo(containerRef.current, {
          width: "100%",
          height: "100%",
          flow: mode === "continuous" ? "scrolled-continuous" : "paginated",
          manager: mode === "continuous" ? "continuous" : "default",
          spread: "none",
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        (rendition as RenditionWithContentHook).hooks?.content?.register?.(bindContent);
        applyReaderContentTheme(rendition, contentThemeRef.current);
        rendition.on("rendered", onRendered);
        rendition.on("relocated", onRelocated);
        rendition.on("selected", onSelected);

        await (rendition as RenditionWithManager).started;
        if (mode === "continuous") {
          stabilizeContinuousRendition(rendition as RenditionWithManager);
        }

        try {
          await rendition.display(displayCfi);
        } catch {
          await rendition.display();
        }

        bindMountedContentDocuments();
        reconcileHighlights();
        void epubBook.locations.generate(1600).catch(() => {
          // Reading can continue without a calculated percentage.
        });

        if (!cancelled) {
          setIsLoading(false);
          callbacksRef.current.onReady();
          deferNavigationLoad(epubBook);
        }
      } catch {
        epubBook?.destroy();
        epubBook = null;

        if (!cancelled) {
          setIsLoading(false);
          callbacksRef.current.onError("This EPUB could not be opened.");
        }
      }
    }

    function onRendered(_section: unknown, view: unknown) {
      pruneDisconnectedContent();
      const document = documentFromRenderedView(view);
      bindContent({
        document: document ?? undefined,
        window: windowFromContentDocument(document) ?? undefined,
      });
      setHighlightMenu((current) => {
        if (!current) return current;
        const anchorRect = current.anchor.resolveRect();
        return anchorRect ? { ...current, anchorRect } : null;
      });
      reconcileHighlights();
    }

    function onSelected(cfiRange: string, contents: EpubContent) {
      const selection = contents.window?.getSelection();
      const selectedText = selection?.toString().trim() ?? "";
      if (!selection || !selectedText || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const sourceDocument = contents.document ?? range.startContainer.ownerDocument;
      if (!sourceDocument) return;
      const anchor = selectionPaletteAnchor(range, sourceDocument);
      const anchorRect = anchor.resolveRect();
      if (!anchorRect) return;
      const resolution = resolveHighlightSelection(cfiRange, highlightsRef.current);
      if (resolution.kind === "blocked") {
        setHighlightMenu(null);
        reportHighlightInteractionFeedback(
          "Overlapping highlights cannot be edited together.",
          sourceDocument,
        );
        callbacksRef.current.onInteraction();
        return;
      }
      clearHighlightInteractionFeedback(sourceDocument);
      setHighlightMenu({
        anchor,
        anchorRect,
        existingHighlight: resolution.kind === "existing" ? resolution.highlight : undefined,
        selection: { cfiRange, chapterHref: contents.section?.href, selectedText },
      });
      callbacksRef.current.onInteraction();
    }

    function onRelocated(location: Location) {
      if (!cancelled) {
        setHighlightMenu(null);
        clearHighlightInteractionFeedback();
        canonicalCfiRef.current = location.start.cfi;
        navigationController.relocate(location);
        callbacksRef.current.onLocationChange(
          normalizeReaderLocation(location, epubBook?.packaging.spine.length ?? 0),
        );
      }
    }

    void openBook();

    return () => {
      cancelled = true;
      cancelDeferredNavigation();
      dismissHighlightMenu(false);
      clearHighlightInteractionFeedback();
      removeContentListeners();

      if (rendition) {
        rendition.off("rendered", onRendered);
        rendition.off("relocated", onRelocated);
        rendition.off("selected", onSelected);
      }

      renditionRef.current = null;
      for (const rendered of renderedHighlightsRef.current.values()) {
        rendered.token.active = false;
      }
      highlightGestures.cancelAll();
      renderedHighlightsRef.current.clear();
      isNavigatingToChapterRef.current = false;
      epubBook?.destroy();
    };
  }, [
    fileBlob,
    clearHighlightInteractionFeedback,
    dismissHighlightMenu,
    dismissHighlightMenuForDocument,
    handleWheel,
    highlightGestures,
    initialCfi,
    mode,
    navigationController,
    reconcileHighlights,
    reportHighlightInteractionFeedback,
    pruneDisconnectedContent,
    removeContentDocument,
  ]);

  useEffect(() => {
    reconcileHighlights();
  }, [highlights, reconcileHighlights]);

  const clearContentSelection = useCallback(() => {
    const owningDocument = highlightMenu?.anchor.document;
    if (owningDocument) {
      owningDocument.getSelection()?.removeAllRanges();
      return;
    }
    for (const document of contentCleanupRef.current.keys()) {
      document.getSelection()?.removeAllRanges();
    }
  }, [highlightMenu?.anchor.document]);

  const chooseHighlightColor = useCallback(
    async (color: ReaderHighlightColor) => {
      if (!highlightMenu || highlightBusy) return;
      setHighlightBusy(true);
      const succeeded = highlightMenu.existingHighlight
        ? await onRecolorHighlight?.(highlightMenu.existingHighlight.id, color)
        : await onCreateHighlight?.(highlightMenu.selection, color);
      setHighlightBusy(false);
      if (succeeded) setHighlightMenu(null);
      if (succeeded) clearContentSelection();
    },
    [clearContentSelection, highlightBusy, highlightMenu, onCreateHighlight, onRecolorHighlight],
  );

  const removeHighlight = useCallback(async () => {
    if (!highlightMenu?.existingHighlight || highlightBusy) return;
    setHighlightBusy(true);
    const removed = await onRemoveHighlight?.(highlightMenu.existingHighlight.id);
    setHighlightBusy(false);
    if (removed) {
      setHighlightMenu(null);
      clearContentSelection();
    }
  }, [clearContentSelection, highlightBusy, highlightMenu, onRemoveHighlight]);

  const chooseHighlightPaletteOption = useCallback(
    (choice: HighlightPaletteChoice) => {
      if (choice === "none") {
        if (highlightMenu?.existingHighlight) {
          void removeHighlight();
        } else {
          clearContentSelection();
          setHighlightMenu(null);
        }
      } else {
        void chooseHighlightColor(choice);
      }
    },
    [chooseHighlightColor, clearContentSelection, highlightMenu, removeHighlight],
  );

  const openSelectionNote = useCallback(() => {
    if (!highlightMenu) return;
    onOpenNote?.(highlightMenu.selection, highlightMenu.existingHighlight);
    clearContentSelection();
    setHighlightMenu(null);
  }, [clearContentSelection, highlightMenu, onOpenNote]);

  useEffect(() => {
    const mountedDocuments = Array.from(
      containerRef.current?.querySelectorAll("iframe") ?? [],
      (frame) => frame.contentDocument,
    );
    applyReaderContentTheme(renditionRef.current, contentTheme, [
      ...contentCleanupRef.current.keys(),
      ...mountedDocuments,
    ]);
    dismissHighlightMenu(false);
  }, [contentTheme, dismissHighlightMenu]);

  const viewerBounds = normalizeClientRect(viewerRef.current?.getBoundingClientRect());
  const paletteViewport: ClientRect = viewerBounds ?? {
    bottom: window.innerHeight,
    height: window.innerHeight,
    left: 0,
    right: window.innerWidth,
    top: 0,
    width: window.innerWidth,
  };

  return (
    <div ref={viewerRef} className="epub-viewer" data-reader-mode={mode} data-reader-theme={theme}>
      <div ref={containerRef} className="epub-viewer__stage" />
      {mode === "paged" ? (
        <button
          aria-label="Previous page"
          className="epub-viewer__click-zone epub-viewer__click-zone--previous"
          onClick={() => handleClickZone("backward")}
          onMouseMove={onInteraction}
          style={
            {
              "--reader-page-turn-zone-width": `${Math.max(0, Math.min(margin, 88))}px`,
            } as CSSProperties
          }
          tabIndex={-1}
          type="button"
        >
          <span
            aria-hidden="true"
            className="epub-viewer__click-zone-icon icon-slot icon-slot--prominent"
          >
            <CaretLeft weight="bold" />
          </span>
        </button>
      ) : null}
      {mode === "paged" ? (
        <button
          aria-label="Next page"
          className="epub-viewer__click-zone epub-viewer__click-zone--next"
          onClick={() => handleClickZone("forward")}
          onMouseMove={onInteraction}
          style={
            {
              "--reader-page-turn-zone-width": `${Math.max(0, Math.min(margin, 88))}px`,
            } as CSSProperties
          }
          tabIndex={-1}
          type="button"
        >
          <span
            aria-hidden="true"
            className="epub-viewer__click-zone-icon icon-slot icon-slot--prominent"
          >
            <CaretRight weight="bold" />
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
      {highlightMenu ? (
        <ReaderHighlightPalette
          ref={highlightMenuRef}
          anchorRect={highlightMenu.anchorRect}
          busy={highlightBusy}
          onChoose={chooseHighlightPaletteOption}
          onDismiss={() => dismissHighlightMenu()}
          onNote={openSelectionNote}
          selectedColor={
            highlightMenu.existingHighlight
              ? normalizeReaderHighlightColor(highlightMenu.existingHighlight.color)
              : undefined
          }
          viewportRect={paletteViewport}
        />
      ) : null}
    </div>
  );
});

function areEpubViewerPropsEqual(previous: EpubViewerProps, next: EpubViewerProps): boolean {
  return (
    previous.fileBlob === next.fileBlob &&
    previous.highlights === next.highlights &&
    previous.initialCfi === next.initialCfi &&
    previous.onError === next.onError &&
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
    previous.settings.mode === next.settings.mode &&
    readerContentSettingsEqual(previous.settings, next.settings)
  );
}

export const EpubViewer = memo(EpubViewerComponent, areEpubViewerPropsEqual);
