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

import type { ReaderNavigationState, ReaderSettings } from "../../types/reader";
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

export type EpubViewerHandle = {
  navigateToChapter: (chapterId: string) => Promise<boolean>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
};

type EpubViewerProps = {
  fileBlob: Blob;
  initialCfi?: string;
  onError: (message: string) => void;
  onInteraction: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onLocationChange: (location: ReaderLocation) => void;
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
  window?: Window;
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

const EpubViewerComponent = forwardRef<EpubViewerHandle, EpubViewerProps>(function EpubViewer(
  {
    fileBlob,
    initialCfi,
    onError,
    onInteraction,
    onKeyDown,
    onLocationChange,
    onNavigationChange,
    onReady,
    settings,
  },
  ref,
) {
  const viewerRef = useRef<HTMLDivElement>(null);
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

  callbacksRef.current = {
    onError,
    onInteraction,
    onKeyDown,
    onLocationChange,
    onNavigationChange,
    onReady,
  };
  contentThemeRef.current = contentTheme;

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

  useImperativeHandle(
    ref,
    () => ({
      navigateToChapter,
      next: () => runPageTurn("forward"),
      previous: () => runPageTurn("backward"),
    }),
    [navigateToChapter, runPageTurn],
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
      document.addEventListener("mousemove", onContentInteraction);
      document.addEventListener("touchstart", onContentInteraction);
      document.addEventListener("click", onContentInteraction);

      const cleanupFunctions = [
        ...wheelTargets.map(
          (target) => () => target.removeEventListener("wheel", onContentWheel, wheelOptions),
        ),
        () => document.removeEventListener("keydown", onContentKeyDown, keyOptions),
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
      }

      renditionRef.current = null;
      isNavigatingToChapterRef.current = false;
      epubBook?.destroy();
    };
  }, [fileBlob, handleWheel, initialCfi, mode, navigationController]);

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
        />
      ) : null}
      {mode === "paged" ? (
        <button
          aria-label="Next page"
          className="epub-viewer__click-zone epub-viewer__click-zone--next"
          onClick={() => handleClickZone("forward")}
          onMouseMove={onInteraction}
          tabIndex={-1}
          type="button"
        />
      ) : null}
      {isLoading ? (
        <div className="reader-loading" role="status">
          <span className="reader-loading__line" />
          <span className="reader-loading__line reader-loading__line--short" />
          <span>Opening book</span>
        </div>
      ) : null}
    </div>
  );
});

function areEpubViewerPropsEqual(previous: EpubViewerProps, next: EpubViewerProps): boolean {
  return (
    previous.fileBlob === next.fileBlob &&
    previous.initialCfi === next.initialCfi &&
    previous.onError === next.onError &&
    previous.onInteraction === next.onInteraction &&
    previous.onKeyDown === next.onKeyDown &&
    previous.onLocationChange === next.onLocationChange &&
    previous.onNavigationChange === next.onNavigationChange &&
    previous.onReady === next.onReady &&
    previous.settings.mode === next.settings.mode &&
    readerContentSettingsEqual(previous.settings, next.settings)
  );
}

export const EpubViewer = memo(EpubViewerComponent, areEpubViewerPropsEqual);
