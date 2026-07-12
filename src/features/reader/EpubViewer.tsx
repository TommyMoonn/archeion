import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Book as EpubBook, Location, Rendition } from "epubjs";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

import type { ReaderNavigationState, ReaderSettings } from "../../types/reader";
import type { Annotation } from "../../types/annotation";
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
  DEFAULT_READER_HIGHLIGHT_COLOR,
  READER_HIGHLIGHT_COLORS,
  normalizeReaderHighlightColor,
  readerHighlightStyles,
  type ReaderHighlightColor,
} from "./readerHighlights";

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
  highlights?: readonly Annotation[];
  initialCfi?: string;
  onError: (message: string) => void;
  onInteraction: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onLocationChange: (location: ReaderLocation) => void;
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
  "onError" | "onInteraction" | "onKeyDown" | "onLocationChange" | "onNavigationChange" | "onReady"
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

type HighlightMenu =
  | { kind: "selection"; selection: ReaderTextSelection; x: number; y: number }
  | { kind: "saved"; highlight: Annotation; x: number; y: number };

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

const EpubViewerComponent = forwardRef<EpubViewerHandle, EpubViewerProps>(function EpubViewer(
  {
    fileBlob,
    highlights = [],
    initialCfi,
    onError,
    onInteraction,
    onKeyDown,
    onLocationChange,
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
    onInteraction,
    onKeyDown,
    onLocationChange,
    onNavigationChange,
    onReady,
  });
  const renditionRef = useRef<Rendition | null>(null);
  const highlightsRef = useRef(highlights);
  const renderedHighlightRangesRef = useRef<string[]>([]);
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

  callbacksRef.current = {
    onError,
    onInteraction,
    onKeyDown,
    onLocationChange,
    onNavigationChange,
    onReady,
  };
  contentThemeRef.current = contentTheme;
  highlightsRef.current = highlights;

  useEffect(() => {
    if (highlightMenu) {
      window.requestAnimationFrame(() =>
        highlightMenuRef.current?.querySelector("button")?.focus(),
      );
    }
  }, [highlightMenu]);

  useEffect(() => {
    if (!highlightMenu) return;

    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !highlightMenuRef.current?.contains(event.target)) {
        setHighlightMenu(null);
      }
    };

    document.addEventListener("pointerdown", dismissOutside, true);
    return () => document.removeEventListener("pointerdown", dismissOutside, true);
  }, [highlightMenu]);

  const reconcileHighlights = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    for (const range of renderedHighlightRangesRef.current)
      rendition.annotations.remove(range, "highlight");
    renderedHighlightRangesRef.current = [];
    const seen = new Set<string>();
    for (const highlight of highlightsRef.current) {
      const range = highlight.cfiRange?.trim();
      if (!range || seen.has(range)) continue;
      seen.add(range);
      rendition.annotations.highlight(
        range,
        { annotationId: highlight.id },
        (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          const frame = containerRef.current?.querySelector("iframe")?.getBoundingClientRect();
          setHighlightMenu({
            kind: "saved",
            highlight,
            x: (frame?.left ?? 0) + event.clientX,
            y: (frame?.top ?? 0) + event.clientY,
          });
        },
        "archeion-highlight",
        readerHighlightStyles(highlight.color),
      );
      renderedHighlightRangesRef.current.push(range);
    }
  }, []);

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
    [navigationController],
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

  const navigateToLocation = useCallback(async (cfi: string) => {
    const rendition = renditionRef.current;
    const target = cfi.trim();
    if (!rendition || !target || isNavigatingToChapterRef.current) {
      return false;
    }

    isNavigatingToChapterRef.current = true;
    callbacksRef.current.onInteraction();
    try {
      await rendition.display(target);
      return true;
    } catch {
      return false;
    } finally {
      isNavigatingToChapterRef.current = false;
    }
  }, []);

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
        callbacksRef.current.onKeyDown(event);
      };
      const onContentInteraction = () => {
        callbacksRef.current.onInteraction();
      };
      const onContentPointerDown = () => {
        setHighlightMenu(null);
      };
      const onSelectionChange = () => {
        if (document.getSelection()?.isCollapsed) setHighlightMenu(null);
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
      ];
      contentCleanupRef.current.set(document, () => {
        for (const cleanup of cleanupFunctions) {
          cleanup();
        }
      });
    }

    function bindMountedIframeDocument() {
      const frame = containerRef.current?.querySelector("iframe");
      bindContent({
        document: frame?.contentDocument ?? undefined,
        window: frame?.contentWindow ?? undefined,
      });
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

        bindMountedIframeDocument();
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
      const document = documentFromRenderedView(view);
      bindContent({
        document: document ?? undefined,
        window: windowFromContentDocument(document) ?? undefined,
      });
      reconcileHighlights();
    }

    function onSelected(cfiRange: string, contents: EpubContent) {
      const selection = contents.window?.getSelection();
      const selectedText = selection?.toString().trim() ?? "";
      if (!selection || !selectedText || selection.rangeCount === 0) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const frame = containerRef.current?.querySelector("iframe")?.getBoundingClientRect();
      setHighlightMenu({
        kind: "selection",
        selection: { cfiRange, chapterHref: contents.section?.href, selectedText },
        x: (frame?.left ?? 0) + rect.left + rect.width / 2,
        y: (frame?.top ?? 0) + rect.top,
      });
      callbacksRef.current.onInteraction();
    }

    function onRelocated(location: Location) {
      if (!cancelled) {
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
      removeContentListeners();

      if (rendition) {
        rendition.off("rendered", onRendered);
        rendition.off("relocated", onRelocated);
        rendition.off("selected", onSelected);
      }

      renditionRef.current = null;
      isNavigatingToChapterRef.current = false;
      epubBook?.destroy();
    };
  }, [fileBlob, handleWheel, initialCfi, mode, navigationController, reconcileHighlights]);

  useEffect(() => {
    reconcileHighlights();
  }, [highlights, reconcileHighlights]);

  const chooseHighlightColor = useCallback(
    async (color: ReaderHighlightColor) => {
      if (!highlightMenu || highlightBusy) return;
      setHighlightBusy(true);
      const succeeded =
        highlightMenu.kind === "selection"
          ? await onCreateHighlight?.(highlightMenu.selection, color)
          : await onRecolorHighlight?.(highlightMenu.highlight.id, color);
      setHighlightBusy(false);
      if (succeeded) setHighlightMenu(null);
      if (succeeded) {
        containerRef.current
          ?.querySelector("iframe")
          ?.contentWindow?.getSelection()
          ?.removeAllRanges();
      }
    },
    [highlightBusy, highlightMenu, onCreateHighlight, onRecolorHighlight],
  );

  const removeHighlight = useCallback(async () => {
    if (highlightMenu?.kind !== "saved" || highlightBusy) return;
    setHighlightBusy(true);
    const removed = await onRemoveHighlight?.(highlightMenu.highlight.id);
    setHighlightBusy(false);
    if (removed) setHighlightMenu(null);
  }, [highlightBusy, highlightMenu, onRemoveHighlight]);

  useEffect(() => {
    const mountedFrame = containerRef.current?.querySelector("iframe");
    applyReaderContentTheme(renditionRef.current, contentTheme, [
      ...contentCleanupRef.current.keys(),
      mountedFrame?.contentDocument ?? null,
    ]);
  }, [contentTheme]);

  return (
    <div ref={viewerRef} className="epub-viewer" data-reader-mode={mode} data-reader-theme={theme}>
      <div ref={containerRef} className="epub-viewer__stage" />
      {mode === "paged" ? (
        <button
          aria-label="Previous page"
          className="epub-viewer__click-zone epub-viewer__click-zone--previous"
          onClick={() => handleClickZone("backward")}
          onMouseMove={onInteraction}
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
        <div
          ref={highlightMenuRef}
          aria-label={highlightMenu.kind === "selection" ? "Highlight selection" : "Edit highlight"}
          className="reader-highlight-menu menu-popover"
          data-reader-ignore-shortcuts
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setHighlightMenu(null);
            }
          }}
          role="menu"
          style={{ left: highlightMenu.x, top: highlightMenu.y }}
        >
          {READER_HIGHLIGHT_COLORS.map((color) => (
            <button
              aria-label={`${color} highlight`}
              aria-checked={
                highlightMenu.kind === "saved"
                  ? normalizeReaderHighlightColor(highlightMenu.highlight.color) === color
                  : DEFAULT_READER_HIGHLIGHT_COLOR === color
              }
              className="reader-highlight-menu__color"
              data-color={color}
              disabled={highlightBusy}
              key={color}
              onClick={() => void chooseHighlightColor(color)}
              role="menuitemradio"
              type="button"
            />
          ))}
          {highlightMenu.kind === "saved" ? (
            <button
              className="reader-highlight-menu__remove"
              disabled={highlightBusy}
              onClick={() => void removeHighlight()}
              role="menuitem"
              type="button"
            >
              Remove
            </button>
          ) : null}
          <button
            aria-label="Close highlight menu"
            className="reader-highlight-menu__close"
            disabled={highlightBusy}
            onClick={() => setHighlightMenu(null)}
            role="menuitem"
            type="button"
          >
            ×
          </button>
        </div>
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
    previous.onInteraction === next.onInteraction &&
    previous.onKeyDown === next.onKeyDown &&
    previous.onLocationChange === next.onLocationChange &&
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
