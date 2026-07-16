import { describe, expect, it } from "vitest";

import {
  canRunReaderWheelTurn,
  getContinuousReaderWheelDelta,
  getReaderKeyboardIntent,
  getReaderWheelDelta,
  getReaderWheelIntentFromDelta,
  isPagedReaderWheelTargetBlocked,
  isReaderTransientSurfaceTarget,
  READER_WHEEL_THROTTLE_MS,
  READER_WHEEL_TURN_DELTA,
  shouldIgnoreReaderWheelEvent,
} from "./readerNavigation";
import { READER_ILLUSTRATION_TRIGGER_SELECTOR } from "./readerIllustrationTrigger";

function keyEvent(
  options: Partial<
    Pick<
      KeyboardEvent,
      "altKey" | "ctrlKey" | "defaultPrevented" | "key" | "metaKey" | "shiftKey" | "target"
    >
  >,
) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    target: null,
    ...options,
  } as KeyboardEvent;
}

function wheelEvent(
  options: Partial<
    Pick<
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
    >
  >,
) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...options,
  } as WheelEvent;
}

function wheelIntent(event: WheelEvent) {
  const delta = getReaderWheelDelta(event);
  return delta === null ? null : getReaderWheelIntentFromDelta(delta);
}

function elementTarget(
  matchingSelector: string | null = null,
  selectionCollapsed = true,
): EventTarget {
  return {
    closest: (selector: string) =>
      matchingSelector && selector.includes(matchingSelector) ? {} : null,
    nodeType: 1,
    ownerDocument: { getSelection: () => ({ isCollapsed: selectionCollapsed }) },
  } as unknown as EventTarget;
}

type NestedElementTarget = {
  closest: (selector: string) => NestedElementTarget | null;
  matchingSelectors: readonly string[];
  nodeType: number;
  ownerDocument: { getSelection: () => { isCollapsed: boolean } };
  parent: NestedElementTarget | null;
  parentElement: NestedElementTarget | null;
};

function nestedElementTarget(
  matchingSelectors: readonly string[],
  parent: EventTarget | null = null,
  selectionCollapsed = true,
): EventTarget {
  const parentTarget = parent as NestedElementTarget | null;
  const target: NestedElementTarget = {
    closest: (selector: string) => {
      let candidate: NestedElementTarget | null = target;
      while (candidate) {
        if (candidate.matchingSelectors.some((match) => selector.includes(match))) return candidate;
        candidate = candidate.parent;
      }
      return null;
    },
    matchingSelectors,
    nodeType: 1,
    ownerDocument: { getSelection: () => ({ isCollapsed: selectionCollapsed }) },
    parent: parentTarget,
    parentElement: parentTarget,
  };
  return target as unknown as EventTarget;
}

describe("reader navigation helpers", () => {
  it("maps paged reader keyboard shortcuts", () => {
    expect(getReaderKeyboardIntent(keyEvent({ key: "ArrowRight" }))).toBe("forward");
    expect(getReaderKeyboardIntent(keyEvent({ key: "PageDown" }))).toBe("forward");
    expect(getReaderKeyboardIntent(keyEvent({ key: " " }))).toBe("forward");
    expect(getReaderKeyboardIntent(keyEvent({ key: "ArrowLeft" }))).toBe("backward");
    expect(getReaderKeyboardIntent(keyEvent({ key: "PageUp" }))).toBe("backward");
    expect(getReaderKeyboardIntent(keyEvent({ key: " ", shiftKey: true }))).toBe("backward");
    expect(getReaderKeyboardIntent(keyEvent({ key: "s" }))).toBe("settings");
    expect(getReaderKeyboardIntent(keyEvent({ key: "Escape" }))).toBe("close");
  });

  it("does not treat modified or selection-style shortcuts as page turns", () => {
    expect(getReaderKeyboardIntent(keyEvent({ key: "ArrowRight", shiftKey: true }))).toBeNull();
    expect(getReaderKeyboardIntent(keyEvent({ key: "ArrowRight", ctrlKey: true }))).toBeNull();
    expect(getReaderKeyboardIntent(keyEvent({ key: "s", metaKey: true }))).toBeNull();
  });

  it("maps vertical wheel gestures to page direction", () => {
    expect(wheelIntent(wheelEvent({ deltaY: 80 }))).toBe("forward");
    expect(wheelIntent(wheelEvent({ deltaY: -80 }))).toBe("backward");
    expect(wheelIntent(wheelEvent({ deltaX: 80, deltaY: 10 }))).toBeNull();
    expect(wheelIntent(wheelEvent({ deltaX: 80, deltaY: 40 }))).toBeNull();
  });

  it("normalizes line-mode wheel deltas", () => {
    expect(getReaderWheelDelta(wheelEvent({ deltaMode: 1, deltaY: 3 }))).toBe(
      READER_WHEEL_TURN_DELTA,
    );
    expect(wheelIntent(wheelEvent({ deltaMode: 1, deltaY: 3 }))).toBe("forward");
  });

  it("allows small smooth-wheel deltas to accumulate before turning", () => {
    expect(getReaderWheelIntentFromDelta(12)).toBeNull();
    expect(getReaderWheelIntentFromDelta(36)).toBeNull();
    expect(getReaderWheelIntentFromDelta(READER_WHEEL_TURN_DELTA)).toBe("forward");
    expect(getReaderWheelIntentFromDelta(-READER_WHEEL_TURN_DELTA)).toBe("backward");
  });

  it("ignores modified wheel gestures", () => {
    expect(getReaderWheelDelta(wheelEvent({ ctrlKey: true, deltaY: 80 }))).toBeNull();
    expect(getReaderWheelDelta(wheelEvent({ metaKey: true, deltaY: 80 }))).toBeNull();
  });

  it("defensively ignores consumed wheel events and transient reader surfaces", () => {
    const transientTarget = {
      closest: (selector: string) => (selector === "[data-reader-ignore-shortcuts]" ? {} : null),
      nodeType: 1,
      ownerDocument: { getSelection: () => null },
    } as unknown as EventTarget;

    expect(isReaderTransientSurfaceTarget(transientTarget)).toBe(true);
    expect(shouldIgnoreReaderWheelEvent(wheelEvent({ target: transientTarget }))).toBe(true);
    expect(getReaderWheelDelta(wheelEvent({ defaultPrevented: true, deltaY: 80 }))).toBeNull();
    expect(getReaderWheelDelta(wheelEvent({ deltaY: 80, target: transientTarget }))).toBeNull();
  });

  it.each([
    "a[href]",
    "area[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[contenteditable='true']",
  ])("blocks paged wheel navigation over %s", (selector) => {
    const target = elementTarget(selector);

    expect(isPagedReaderWheelTargetBlocked(target)).toBe(true);
    expect(getReaderWheelDelta(wheelEvent({ deltaY: 80, target }))).toBeNull();
  });

  it("blocks paged wheel navigation while the target document has a text selection", () => {
    const target = elementTarget(null, false);

    expect(isPagedReaderWheelTargetBlocked(target)).toBe(true);
    expect(getReaderWheelDelta(wheelEvent({ deltaY: 80, target }))).toBeNull();
  });

  it("keeps a standalone reader-owned illustration wheel-eligible but shortcut-blocked", () => {
    const illustration = nestedElementTarget([
      READER_ILLUSTRATION_TRIGGER_SELECTOR,
      "[role='button']",
    ]);

    expect(isPagedReaderWheelTargetBlocked(illustration)).toBe(false);
    expect(getReaderWheelDelta(wheelEvent({ deltaY: 80, target: illustration }))).toBe(80);
    expect(getContinuousReaderWheelDelta(wheelEvent({ deltaY: 80, target: illustration }))).toBe(
      80,
    );
    expect(
      getReaderKeyboardIntent(keyEvent({ key: "ArrowRight", target: illustration })),
    ).toBeNull();
    const publisherStyledIllustration = nestedElementTarget([READER_ILLUSTRATION_TRIGGER_SELECTOR]);
    expect(
      getReaderKeyboardIntent(keyEvent({ key: "ArrowRight", target: publisherStyledIllustration })),
    ).toBeNull();
  });

  it.each(["a", "button"])(
    "keeps a marked illustration inside a publisher %s blocked in paged mode",
    (ownerSelector) => {
      const owner = nestedElementTarget([ownerSelector === "a" ? "a[href]" : "button"]);
      const illustration = nestedElementTarget(
        [READER_ILLUSTRATION_TRIGGER_SELECTOR, "[role='button']"],
        owner,
      );

      expect(isPagedReaderWheelTargetBlocked(illustration)).toBe(true);
      expect(getReaderWheelDelta(wheelEvent({ deltaY: 80, target: illustration }))).toBeNull();
      expect(getContinuousReaderWheelDelta(wheelEvent({ deltaY: 80, target: illustration }))).toBe(
        80,
      );
    },
  );

  it("keeps a standalone illustration blocked while its document has an active selection", () => {
    const illustration = nestedElementTarget(
      [READER_ILLUSTRATION_TRIGGER_SELECTOR, "[role='button']"],
      null,
      false,
    );

    expect(isPagedReaderWheelTargetBlocked(illustration)).toBe(true);
    expect(getReaderWheelDelta(wheelEvent({ deltaY: 80, target: illustration }))).toBeNull();
  });

  it("keeps ordinary targets paged-eligible and interactive targets continuous-eligible", () => {
    const ordinaryTarget = elementTarget();
    const linkTarget = elementTarget("a[href]");

    expect(getReaderWheelDelta(wheelEvent({ deltaY: 80, target: ordinaryTarget }))).toBe(80);
    expect(getReaderKeyboardIntent(keyEvent({ key: "ArrowRight", target: linkTarget }))).toBeNull();
    expect(getContinuousReaderWheelDelta(wheelEvent({ deltaY: 80, target: linkTarget }))).toBe(80);
  });

  it("throttles wheel page turns", () => {
    expect(canRunReaderWheelTurn(1000, 1000)).toBe(false);
    expect(canRunReaderWheelTurn(1000 + READER_WHEEL_THROTTLE_MS, 1000)).toBe(true);
  });
});
