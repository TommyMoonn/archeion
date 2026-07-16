export const READER_ILLUSTRATION_MIN_SCALE = 0.25;
export const READER_ILLUSTRATION_MAX_SCALE = 4;
export const READER_ILLUSTRATION_SCALE_FACTOR = 1.25;
export const READER_ILLUSTRATION_CANVAS_PADDING = 18;
export const READER_ILLUSTRATION_WHEEL_THRESHOLD = 48;
export const READER_ILLUSTRATION_WHEEL_RESET_MS = 220;
export const READER_ILLUSTRATION_WHEEL_THROTTLE_MS = 80;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_LINE_DELTA_PX = 16;
const WHEEL_PAGE_DELTA_PX = 800;
const GEOMETRY_EPSILON = 0.01;

export type IllustrationSize = Readonly<{ height: number; width: number }>;
export type IllustrationPoint = Readonly<{ x: number; y: number }>;
export type IllustrationScrollPosition = Readonly<{ left: number; top: number }>;
export type IllustrationZoomDirection = "in" | "out";
export type IllustrationZoomState =
  Readonly<{ mode: "fit" }> | Readonly<{ mode: "explicit"; scale: number }>;

export type IllustrationCanvasGeometry = Readonly<{
  canvasHeight: number;
  canvasWidth: number;
  imageHeight: number;
  imageLeft: number;
  imageTop: number;
  imageWidth: number;
  maxScrollLeft: number;
  maxScrollTop: number;
  pannable: boolean;
  scale: number;
}>;

export type IllustrationWheelAccumulation = Readonly<{
  accumulated: number;
  direction: IllustrationZoomDirection | null;
}>;

export function calculateIllustrationFitScale(
  image: IllustrationSize,
  viewport: IllustrationSize,
  padding = READER_ILLUSTRATION_CANVAS_PADDING,
): number {
  if (!validSize(image) || !validSize(viewport)) return 1;
  const usableWidth = Math.max(viewport.width - padding * 2, 1);
  const usableHeight = Math.max(viewport.height - padding * 2, 1);
  return Math.min(1, usableWidth / image.width, usableHeight / image.height);
}

export function resolveIllustrationScale(zoom: IllustrationZoomState, fitScale: number): number {
  return zoom.mode === "fit"
    ? validScale(fitScale, 1)
    : clampIllustrationScale(zoom.scale, fitScale);
}

export function clampIllustrationScale(scale: number, fitScale: number): number {
  const minimum = Math.min(READER_ILLUSTRATION_MIN_SCALE, validScale(fitScale, 1));
  return Math.min(Math.max(validScale(scale, minimum), minimum), READER_ILLUSTRATION_MAX_SCALE);
}

export function stepIllustrationScale(
  scale: number,
  direction: IllustrationZoomDirection,
  fitScale: number,
): number {
  const factor =
    direction === "in" ? READER_ILLUSTRATION_SCALE_FACTOR : 1 / READER_ILLUSTRATION_SCALE_FACTOR;
  return clampIllustrationScale(scale * factor, fitScale);
}

export function normalizeIllustrationWheelDelta(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const normalized =
    deltaMode === DOM_DELTA_LINE
      ? deltaY * WHEEL_LINE_DELTA_PX
      : deltaMode === DOM_DELTA_PAGE
        ? deltaY * WHEEL_PAGE_DELTA_PX
        : deltaY;
  return Math.min(
    Math.max(normalized, -READER_ILLUSTRATION_WHEEL_THRESHOLD),
    READER_ILLUSTRATION_WHEEL_THRESHOLD,
  );
}

export function accumulateIllustrationWheelDelta(
  accumulated: number,
  delta: number,
): IllustrationWheelAccumulation {
  if (!Number.isFinite(delta) || delta === 0) return { accumulated, direction: null };
  const continued = accumulated === 0 || Math.sign(accumulated) === Math.sign(delta);
  const next = (continued ? accumulated : 0) + delta;
  if (Math.abs(next) < READER_ILLUSTRATION_WHEEL_THRESHOLD) {
    return { accumulated: next, direction: null };
  }
  return { accumulated: 0, direction: next < 0 ? "in" : "out" };
}

export function calculateIllustrationCanvasGeometry(
  image: IllustrationSize,
  viewport: IllustrationSize,
  scale: number,
  padding = READER_ILLUSTRATION_CANVAS_PADDING,
): IllustrationCanvasGeometry {
  const safeScale = validScale(scale, 1);
  const imageWidth = Math.max(image.width * safeScale, 0);
  const imageHeight = Math.max(image.height * safeScale, 0);
  const overflowsHorizontally = imageWidth - viewport.width > GEOMETRY_EPSILON;
  const overflowsVertically = imageHeight - viewport.height > GEOMETRY_EPSILON;
  const canvasWidth = overflowsHorizontally ? imageWidth + padding * 2 : viewport.width;
  const canvasHeight = overflowsVertically ? imageHeight + padding * 2 : viewport.height;
  const maxScrollLeft = Math.max(canvasWidth - viewport.width, 0);
  const maxScrollTop = Math.max(canvasHeight - viewport.height, 0);
  return {
    canvasHeight,
    canvasWidth,
    imageHeight,
    imageLeft: (canvasWidth - imageWidth) / 2,
    imageTop: (canvasHeight - imageHeight) / 2,
    imageWidth,
    maxScrollLeft,
    maxScrollTop,
    pannable: overflowsHorizontally || overflowsVertically,
    scale: safeScale,
  };
}

export function preserveIllustrationFocalPoint(
  input: Readonly<{
    focalPoint: IllustrationPoint;
    next: IllustrationCanvasGeometry;
    previous: IllustrationCanvasGeometry;
    scroll: IllustrationScrollPosition;
    viewport: IllustrationSize;
  }>,
): IllustrationScrollPosition {
  const focalX = clamp(input.focalPoint.x, 0, input.viewport.width);
  const focalY = clamp(input.focalPoint.y, 0, input.viewport.height);
  const imageX = (input.scroll.left + focalX - input.previous.imageLeft) / input.previous.scale;
  const imageY = (input.scroll.top + focalY - input.previous.imageTop) / input.previous.scale;
  return clampIllustrationPan(
    {
      left: input.next.imageLeft + imageX * input.next.scale - focalX,
      top: input.next.imageTop + imageY * input.next.scale - focalY,
    },
    input.next,
  );
}

export function clampIllustrationPan(
  position: IllustrationScrollPosition,
  geometry: IllustrationCanvasGeometry,
): IllustrationScrollPosition {
  return {
    left: clamp(position.left, 0, geometry.maxScrollLeft),
    top: clamp(position.top, 0, geometry.maxScrollTop),
  };
}

export function moveIllustrationPan(
  position: IllustrationScrollPosition,
  movement: IllustrationScrollPosition,
  geometry: IllustrationCanvasGeometry,
): IllustrationScrollPosition {
  return clampIllustrationPan(
    { left: position.left + movement.left, top: position.top + movement.top },
    geometry,
  );
}

function validSize(size: IllustrationSize): boolean {
  return (
    Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
  );
}

function validScale(scale: number, fallback: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
