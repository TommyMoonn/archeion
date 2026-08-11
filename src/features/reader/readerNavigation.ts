import {
  isPublisherImageMapIllustration,
  READER_ILLUSTRATION_TRIGGER_SELECTOR,
  READER_PUBLISHER_INTERACTIVE_SELECTOR,
} from "./readerIllustrationTrigger";

export type ReaderNavigationIntent = "backward" | "forward";

export type ReaderLeaveSettlement = Readonly<{
  owns: () => boolean;
  retire: () => void | Promise<void>;
  settle: () => Promise<boolean>;
}>;

export const READER_CONTENTS_SEARCH_THRESHOLD = 12;
export const READER_WHEEL_THROTTLE_MS = 360;
export const READER_WHEEL_TURN_DELTA = 48;
export const READER_WHEEL_GESTURE_RESET_MS = 260;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_LINE_DELTA_PX = 16;
const WHEEL_PAGE_DELTA_PX = 800;
const READER_TRANSIENT_SURFACE_SELECTOR = "[data-reader-ignore-shortcuts]";

export async function settleAndRetireReaderSession({
  owns,
  retire,
  settle,
}: ReaderLeaveSettlement): Promise<boolean> {
  if (!owns()) return false;

  let settled: boolean;
  try {
    settled = await settle();
  } catch {
    return false;
  }
  if (!settled || !owns()) return false;

  try {
    await retire();
  } catch {
    return false;
  }
  return owns();
}

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
  return (
    isReaderTransientSurfaceTarget(target) ||
    isReaderIllustrationTriggerTarget(target) ||
    isReaderInteractiveOrSelectionTarget(target)
  );
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
  const element = eventTargetElement(target);
  if (!element) return false;
  if (hasActiveReaderSelection(element)) return true;
  if (isPublisherImageMapIllustration(element)) return true;
  if (isStandaloneReaderIllustrationTrigger(element)) return false;
  return Boolean(element.closest(READER_PUBLISHER_INTERACTIVE_SELECTOR));
}

function isReaderInteractiveOrSelectionTarget(target: EventTarget | null): boolean {
  const element = eventTargetElement(target);
  if (!element) return false;
  return (
    Boolean(element.closest(READER_PUBLISHER_INTERACTIVE_SELECTOR)) ||
    hasActiveReaderSelection(element)
  );
}

function isReaderIllustrationTriggerTarget(target: EventTarget | null): boolean {
  return Boolean(eventTargetElement(target)?.closest(READER_ILLUSTRATION_TRIGGER_SELECTOR));
}

function isStandaloneReaderIllustrationTrigger(element: Element): boolean {
  const trigger = element.closest(READER_ILLUSTRATION_TRIGGER_SELECTOR);
  if (!trigger) return false;
  const targetInteractive = element.closest(READER_PUBLISHER_INTERACTIVE_SELECTOR);
  if (targetInteractive && targetInteractive !== trigger) return false;
  return !trigger.parentElement?.closest(READER_PUBLISHER_INTERACTIVE_SELECTOR);
}

function hasActiveReaderSelection(element: Element): boolean {
  const selection = element.ownerDocument.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

export function isReaderKeyboardCommandEligible(event: KeyboardEvent): boolean {
  return !isReaderShortcutTargetBlocked(event.target);
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
