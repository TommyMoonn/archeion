export type ReaderNavigationIntent = "backward" | "forward";
export type ReaderKeyboardIntent =
  | ReaderNavigationIntent
  | "close"
  | "settings";

export const READER_WHEEL_THROTTLE_MS = 360;
export const READER_WHEEL_TURN_DELTA = 48;
export const READER_WHEEL_GESTURE_RESET_MS = 260;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_LINE_DELTA_PX = 16;
const WHEEL_PAGE_DELTA_PX = 800;

const interactiveSelector = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[contenteditable='true']",
  "[data-reader-ignore-shortcuts]",
].join(", ");

type ReaderWheelEvent = Pick<
  WheelEvent,
  | "altKey"
  | "ctrlKey"
  | "deltaMode"
  | "deltaX"
  | "deltaY"
  | "metaKey"
  | "shiftKey"
>;

export function isReaderShortcutTargetBlocked(target: EventTarget | null) {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }

  if (target.closest(interactiveSelector)) {
    return true;
  }

  const selection = target.ownerDocument.getSelection();

  return Boolean(selection && !selection.isCollapsed);
}

export function getReaderKeyboardIntent(
  event: KeyboardEvent,
): ReaderKeyboardIntent | null {
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
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
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

export function getReaderWheelIntentFromDelta(
  deltaY: number,
): ReaderNavigationIntent | null {
  if (Math.abs(deltaY) < READER_WHEEL_TURN_DELTA) {
    return null;
  }

  return deltaY > 0 ? "forward" : "backward";
}

export function getReaderWheelIntent(
  event: ReaderWheelEvent,
): ReaderNavigationIntent | null {
  const deltaY = getReaderWheelDelta(event);

  return deltaY === null ? null : getReaderWheelIntentFromDelta(deltaY);
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
