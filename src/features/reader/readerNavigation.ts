export type ReaderNavigationIntent = "backward" | "forward";
export type ReaderKeyboardIntent = ReaderNavigationIntent | "close" | "settings";

export const READER_WHEEL_THROTTLE_MS = 360;
export const READER_WHEEL_TURN_DELTA = 48;
export const READER_WHEEL_GESTURE_RESET_MS = 260;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_LINE_DELTA_PX = 16;
const WHEEL_PAGE_DELTA_PX = 800;
const READER_TRANSIENT_SURFACE_SELECTOR = "[data-reader-ignore-shortcuts]";

const interactiveSelector = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[contenteditable='true']",
].join(", ");

type ReaderWheelEvent = Pick<
  WheelEvent,
  | "altKey"
  | "ctrlKey"
  | "defaultPrevented"
  | "deltaMode"
  | "deltaX"
  | "deltaY"
  | "metaKey"
  | "shiftKey"
  | "target"
>;

export function isReaderShortcutTargetBlocked(target: EventTarget | null) {
  return isReaderTransientSurfaceTarget(target) || isReaderInteractiveOrSelectionTarget(target);
}

export function isReaderTransientSurfaceTarget(target: EventTarget | null): boolean {
  return Boolean(eventTargetElement(target)?.closest(READER_TRANSIENT_SURFACE_SELECTOR));
}

export function shouldIgnoreReaderWheelEvent(
  event: Pick<WheelEvent, "defaultPrevented" | "target">,
): boolean {
  return event.defaultPrevented || isReaderTransientSurfaceTarget(event.target);
}

export function isPagedReaderWheelTargetBlocked(target: EventTarget | null): boolean {
  return isReaderInteractiveOrSelectionTarget(target);
}

function isReaderInteractiveOrSelectionTarget(target: EventTarget | null): boolean {
  const element = eventTargetElement(target);
  if (!element) return false;
  if (element.closest(interactiveSelector)) return true;
  const selection = element.ownerDocument.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

export function getReaderKeyboardIntent(event: KeyboardEvent): ReaderKeyboardIntent | null {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }

  if (event.key === "Escape") {
    return "close";
  }

  if (isReaderShortcutTargetBlocked(event.target)) {
    return null;
  }

  if (event.shiftKey && event.key !== " ") {
    return null;
  }

  switch (event.key) {
    case "ArrowLeft":
    case "PageUp":
      return "backward";
    case "ArrowRight":
    case "PageDown":
      return "forward";
    case " ":
      return event.shiftKey ? "backward" : "forward";
    default:
      return event.shiftKey ? null : event.key.toLowerCase() === "s" ? "settings" : null;
  }
}

export function getReaderWheelDelta(event: ReaderWheelEvent): number | null {
  const delta = getModeEligibleReaderWheelDelta(event);
  return delta === null || isPagedReaderWheelTargetBlocked(event.target) ? null : delta;
}

export function getContinuousReaderWheelDelta(event: ReaderWheelEvent): number | null {
  return getModeEligibleReaderWheelDelta(event);
}

function getModeEligibleReaderWheelDelta(event: ReaderWheelEvent): number | null {
  if (
    shouldIgnoreReaderWheelEvent(event) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return null;
  }

  const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode);
  const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode);
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absY === 0 || absY < absX) {
    return null;
  }

  return deltaY;
}

function eventTargetElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== "object") return null;
  const candidate = target as Partial<Element>;
  return candidate.nodeType === 1 && typeof candidate.closest === "function"
    ? (target as Element)
    : null;
}

export function getReaderWheelIntentFromDelta(deltaY: number): ReaderNavigationIntent | null {
  if (Math.abs(deltaY) < READER_WHEEL_TURN_DELTA) {
    return null;
  }

  return deltaY > 0 ? "forward" : "backward";
}

export function canRunReaderWheelTurn(now: number, lastTurnAt: number) {
  return now - lastTurnAt >= READER_WHEEL_THROTTLE_MS;
}

function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === DOM_DELTA_LINE) {
    return delta * WHEEL_LINE_DELTA_PX;
  }

  if (deltaMode === DOM_DELTA_PAGE) {
    return delta * WHEEL_PAGE_DELTA_PX;
  }

  return delta;
}
