import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  accumulateIllustrationWheelDelta,
  calculateIllustrationCanvasGeometry,
  calculateIllustrationFitScale,
  clampIllustrationPan,
  moveIllustrationPan,
  normalizeIllustrationWheelDelta,
  preserveIllustrationFocalPoint,
  resolveIllustrationScale,
  stepIllustrationScale,
  READER_ILLUSTRATION_WHEEL_RESET_MS,
  READER_ILLUSTRATION_WHEEL_THROTTLE_MS,
  type IllustrationPoint,
  type IllustrationScrollPosition,
  type IllustrationSize,
  type IllustrationZoomDirection,
  type IllustrationZoomState,
} from "./readerIllustrationInteraction";
import type { ResolvedEpubIllustration } from "./epubIllustrationResolver";

const KEYBOARD_PAN_STEP = 56;
const FIT_ZOOM: IllustrationZoomState = Object.freeze({ mode: "fit" });

type PanOrigin = Readonly<{
  left: number;
  pointerId: number;
  top: number;
  x: number;
  y: number;
}>;

export type ReaderIllustrationInteraction = Readonly<{
  canZoomIn: boolean;
  canZoomOut: boolean;
  canvasStyle?: CSSProperties;
  fitToViewport: () => void;
  handleKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => void;
  handleLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  imageStyle?: CSSProperties;
  pannable: boolean;
  showActualSize: () => void;
  viewportLabel: string;
  zoomIn: () => void;
  zoomLabel: string;
  zoomOut: () => void;
}>;

export function useReaderIllustrationInteraction(
  resource: ResolvedEpubIllustration | undefined,
  dialogRef: RefObject<HTMLDialogElement | null>,
  viewportRef: RefObject<HTMLDivElement | null>,
): ReaderIllustrationInteraction {
  const panRef = useRef<PanOrigin | null>(null);
  const pendingScrollRef = useRef<IllustrationScrollPosition | null>(null);
  const wheelDeltaRef = useRef(0);
  const lastWheelEventAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastWheelStepAtRef = useRef(Number.NEGATIVE_INFINITY);
  const zoomRef = useRef<IllustrationZoomState>(FIT_ZOOM);
  const [zoom, setZoom] = useState<IllustrationZoomState>(FIT_ZOOM);
  const [viewportSize, setViewportSize] = useState<IllustrationSize>({ height: 0, width: 0 });

  const imageSize = useMemo<IllustrationSize>(
    () => ({ height: resource?.height ?? 0, width: resource?.width ?? 0 }),
    [resource?.height, resource?.width],
  );
  const fitScale = calculateIllustrationFitScale(imageSize, viewportSize);
  const scale = resolveIllustrationScale(zoom, fitScale);
  const geometry = calculateIllustrationCanvasGeometry(imageSize, viewportSize, scale);

  const clearPan = useCallback(
    (releaseCapture: boolean) => {
      const viewport = viewportRef.current;
      const pan = panRef.current;
      panRef.current = null;
      if (viewport) delete viewport.dataset.panning;
      if (
        releaseCapture &&
        viewport?.hasPointerCapture?.(pan?.pointerId ?? -1) &&
        pan?.pointerId !== undefined
      ) {
        viewport.releasePointerCapture(pan.pointerId);
      }
    },
    [viewportRef],
  );

  const clearWheelGesture = useCallback(() => {
    wheelDeltaRef.current = 0;
    lastWheelEventAtRef.current = Number.NEGATIVE_INFINITY;
    lastWheelStepAtRef.current = Number.NEGATIVE_INFINITY;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => measureViewport(viewport, setViewportSize));
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measureViewport(viewport, setViewportSize));
    observer?.observe(viewport);
    const handleResize = () => measureViewport(viewport, setViewportSize);
    if (!observer) window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [viewportRef]);

  useLayoutEffect(
    () => () => {
      clearPan(true);
      clearWheelGesture();
    },
    [clearPan, clearWheelGesture],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const currentGeometry = calculateIllustrationCanvasGeometry(imageSize, viewportSize, scale);
    const pending = pendingScrollRef.current;
    pendingScrollRef.current = null;
    const next =
      pending ??
      (zoom.mode === "fit"
        ? { left: 0, top: 0 }
        : clampIllustrationPan(
            { left: viewport.scrollLeft, top: viewport.scrollTop },
            currentGeometry,
          ));
    viewport.scrollTo({ behavior: "auto", left: next.left, top: next.top });
  }, [imageSize, scale, viewportRef, viewportSize, zoom.mode]);

  function changeScale(
    direction: IllustrationZoomDirection,
    focalPoint?: IllustrationPoint,
  ): boolean {
    const viewport = viewportRef.current;
    if (!resource || !viewport) return false;
    const liveViewport = readViewportSize(viewport, viewportSize);
    const liveFitScale = calculateIllustrationFitScale(imageSize, liveViewport);
    const currentScale = resolveIllustrationScale(zoomRef.current, liveFitScale);
    const nextScale = stepIllustrationScale(currentScale, direction, liveFitScale);
    if (nextScale === currentScale) return false;

    const previousGeometry = calculateIllustrationCanvasGeometry(
      imageSize,
      liveViewport,
      currentScale,
    );
    const nextGeometry = calculateIllustrationCanvasGeometry(imageSize, liveViewport, nextScale);
    const scroll = pendingScrollRef.current ?? {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    pendingScrollRef.current = preserveIllustrationFocalPoint({
      focalPoint: focalPoint ?? { x: liveViewport.width / 2, y: liveViewport.height / 2 },
      next: nextGeometry,
      previous: previousGeometry,
      scroll,
      viewport: liveViewport,
    });
    if (!nextGeometry.pannable) clearPan(true);
    const nextZoom: IllustrationZoomState = { mode: "explicit", scale: nextScale };
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    return true;
  }

  const handleNativeWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const viewport = viewportRef.current;
    if (!resource || !viewport || !isNodeWithin(viewport, event.target)) {
      clearWheelGesture();
      return;
    }

    const now = event.timeStamp;
    if (now - lastWheelEventAtRef.current > READER_ILLUSTRATION_WHEEL_RESET_MS) {
      wheelDeltaRef.current = 0;
    }
    lastWheelEventAtRef.current = now;
    const accumulation = accumulateIllustrationWheelDelta(
      wheelDeltaRef.current,
      normalizeIllustrationWheelDelta(event.deltaY, event.deltaMode),
    );
    wheelDeltaRef.current = accumulation.accumulated;
    if (
      !accumulation.direction ||
      now - lastWheelStepAtRef.current < READER_ILLUSTRATION_WHEEL_THROTTLE_MS
    ) {
      return;
    }
    lastWheelStepAtRef.current = now;
    const rect = viewport.getBoundingClientRect();
    changeScale(accumulation.direction, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  });

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const options: AddEventListenerOptions = { capture: true, passive: false };
    dialog.addEventListener("wheel", handleNativeWheel, options);
    return () => dialog.removeEventListener("wheel", handleNativeWheel, options);
  }, [dialogRef]);

  function fitToViewport() {
    const viewport = viewportRef.current;
    clearPan(true);
    clearWheelGesture();
    pendingScrollRef.current = { left: 0, top: 0 };
    zoomRef.current = FIT_ZOOM;
    setZoom(FIT_ZOOM);
    viewport?.scrollTo({ behavior: "auto", left: 0, top: 0 });
  }

  function showActualSize() {
    setExplicitScale(1);
  }

  function setExplicitScale(nextScale: number) {
    const viewport = viewportRef.current;
    if (!resource || !viewport) return;
    const liveViewport = readViewportSize(viewport, viewportSize);
    const liveFitScale = calculateIllustrationFitScale(imageSize, liveViewport);
    const currentScale = resolveIllustrationScale(zoomRef.current, liveFitScale);
    const nextZoom: IllustrationZoomState = { mode: "explicit", scale: nextScale };
    const resolvedNextScale = resolveIllustrationScale(nextZoom, liveFitScale);
    const previousGeometry = calculateIllustrationCanvasGeometry(
      imageSize,
      liveViewport,
      currentScale,
    );
    const nextGeometry = calculateIllustrationCanvasGeometry(
      imageSize,
      liveViewport,
      resolvedNextScale,
    );
    pendingScrollRef.current = preserveIllustrationFocalPoint({
      focalPoint: { x: liveViewport.width / 2, y: liveViewport.height / 2 },
      next: nextGeometry,
      previous: previousGeometry,
      scroll: pendingScrollRef.current ?? {
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      },
      viewport: liveViewport,
    });
    if (!nextGeometry.pannable) clearPan(true);
    const resolvedZoom: IllustrationZoomState = { mode: "explicit", scale: resolvedNextScale };
    zoomRef.current = resolvedZoom;
    setZoom(resolvedZoom);
  }

  function panBy(left: number, top: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = moveIllustrationPan(
      { left: viewport.scrollLeft, top: viewport.scrollTop },
      { left, top },
      geometry,
    );
    viewport.scrollTo({ behavior: "auto", left: next.left, top: next.top });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case "+":
      case "=":
        consumeKeyboardEvent(event);
        changeScale("in");
        break;
      case "-":
        consumeKeyboardEvent(event);
        changeScale("out");
        break;
      case "0":
        consumeKeyboardEvent(event);
        fitToViewport();
        break;
      case "ArrowLeft":
        consumeKeyboardEvent(event);
        panBy(-KEYBOARD_PAN_STEP, 0);
        break;
      case "ArrowRight":
        consumeKeyboardEvent(event);
        panBy(KEYBOARD_PAN_STEP, 0);
        break;
      case "ArrowUp":
        consumeKeyboardEvent(event);
        panBy(0, -KEYBOARD_PAN_STEP);
        break;
      case "ArrowDown":
        consumeKeyboardEvent(event);
        panBy(0, KEYBOARD_PAN_STEP);
        break;
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport || !geometry.pannable || event.button !== 0 || event.isPrimary === false) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearPan(true);
    panRef.current = {
      left: viewport.scrollLeft,
      pointerId: event.pointerId,
      top: viewport.scrollTop,
      x: event.clientX,
      y: event.clientY,
    };
    viewport.dataset.panning = "";
    viewport.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const origin = panRef.current;
    if (!viewport || !origin || origin.pointerId !== event.pointerId) return;
    event.preventDefault();
    const next = moveIllustrationPan(
      { left: origin.left, top: origin.top },
      { left: origin.x - event.clientX, top: origin.y - event.clientY },
      geometry,
    );
    viewport.scrollLeft = next.left;
    viewport.scrollTop = next.top;
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId === event.pointerId) clearPan(true);
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId === event.pointerId) clearPan(false);
  }

  function handleLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId === event.pointerId) clearPan(false);
  }

  const canZoomIn = Boolean(resource && stepIllustrationScale(scale, "in", fitScale) > scale);
  const canZoomOut = Boolean(resource && stepIllustrationScale(scale, "out", fitScale) < scale);
  const roundedScale = Math.round(scale * 100);

  return {
    canZoomIn,
    canZoomOut,
    canvasStyle: resource
      ? { height: `${geometry.canvasHeight}px`, width: `${geometry.canvasWidth}px` }
      : undefined,
    fitToViewport,
    handleKeyDown,
    handleLostPointerCapture,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    imageStyle: resource
      ? {
          height: `${geometry.imageHeight}px`,
          left: `${geometry.imageLeft}px`,
          top: `${geometry.imageTop}px`,
          width: `${geometry.imageWidth}px`,
        }
      : undefined,
    pannable: geometry.pannable,
    showActualSize,
    viewportLabel: geometry.pannable
      ? "Illustration viewport. Drag or use arrow keys to pan."
      : "Illustration viewport.",
    zoomIn: () => changeScale("in"),
    zoomLabel: zoom.mode === "fit" ? `Fit · ${roundedScale}%` : `${roundedScale}%`,
    zoomOut: () => changeScale("out"),
  };
}

function measureViewport(
  viewport: HTMLDivElement,
  publish: Dispatch<SetStateAction<IllustrationSize>>,
) {
  const next = { height: viewport.clientHeight, width: viewport.clientWidth };
  publish((current) =>
    current.height === next.height && current.width === next.width ? current : next,
  );
}

function readViewportSize(viewport: HTMLDivElement, fallback: IllustrationSize): IllustrationSize {
  return viewport.clientWidth > 0 && viewport.clientHeight > 0
    ? { height: viewport.clientHeight, width: viewport.clientWidth }
    : fallback;
}

function consumeKeyboardEvent(event: KeyboardEvent<HTMLDialogElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function isNodeWithin(container: Element, target: EventTarget | null): boolean {
  return Boolean(target && typeof target === "object" && container.contains(target as Node));
}
