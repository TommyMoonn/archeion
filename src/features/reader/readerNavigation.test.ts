import { describe, expect, it } from "vitest";

import {
  canRunReaderWheelTurn,
  getReaderKeyboardIntent,
  getReaderWheelDelta,
  getReaderWheelIntent,
  getReaderWheelIntentFromDelta,
  READER_WHEEL_THROTTLE_MS,
  READER_WHEEL_TURN_DELTA,
} from "./readerNavigation";

function keyEvent(
  options: Partial<
    Pick<
      KeyboardEvent,
      | "altKey"
      | "ctrlKey"
      | "defaultPrevented"
      | "key"
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
      | "deltaMode"
      | "deltaX"
      | "deltaY"
      | "metaKey"
      | "shiftKey"
    >
  >,
) {
  return {
    altKey: false,
    ctrlKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    metaKey: false,
    shiftKey: false,
    ...options,
  } as WheelEvent;
}

describe("reader navigation helpers", () => {
  it("maps paged reader keyboard shortcuts", () => {
    expect(getReaderKeyboardIntent(keyEvent({ key: "ArrowRight" }))).toBe(
      "forward",
    );
    expect(getReaderKeyboardIntent(keyEvent({ key: "PageDown" }))).toBe(
      "forward",
    );
    expect(getReaderKeyboardIntent(keyEvent({ key: " " }))).toBe("forward");
    expect(getReaderKeyboardIntent(keyEvent({ key: "ArrowLeft" }))).toBe(
      "backward",
    );
    expect(getReaderKeyboardIntent(keyEvent({ key: "PageUp" }))).toBe(
      "backward",
    );
    expect(
      getReaderKeyboardIntent(keyEvent({ key: " ", shiftKey: true })),
    ).toBe("backward");
    expect(getReaderKeyboardIntent(keyEvent({ key: "s" }))).toBe("settings");
    expect(getReaderKeyboardIntent(keyEvent({ key: "Escape" }))).toBe("close");
  });

  it("does not treat modified or selection-style shortcuts as page turns", () => {
    expect(
      getReaderKeyboardIntent(keyEvent({ key: "ArrowRight", shiftKey: true })),
    ).toBeNull();
    expect(
      getReaderKeyboardIntent(keyEvent({ key: "ArrowRight", ctrlKey: true })),
    ).toBeNull();
    expect(
      getReaderKeyboardIntent(keyEvent({ key: "s", metaKey: true })),
    ).toBeNull();
  });

  it("maps vertical wheel gestures to page direction", () => {
    expect(getReaderWheelIntent(wheelEvent({ deltaY: 80 }))).toBe("forward");
    expect(getReaderWheelIntent(wheelEvent({ deltaY: -80 }))).toBe("backward");
    expect(getReaderWheelIntent(wheelEvent({ deltaX: 80, deltaY: 10 }))).toBeNull();
    expect(getReaderWheelIntent(wheelEvent({ deltaX: 80, deltaY: 40 }))).toBeNull();
  });

  it("normalizes line-mode wheel deltas", () => {
    expect(getReaderWheelDelta(wheelEvent({ deltaMode: 1, deltaY: 3 }))).toBe(
      READER_WHEEL_TURN_DELTA,
    );
    expect(getReaderWheelIntent(wheelEvent({ deltaMode: 1, deltaY: 3 }))).toBe(
      "forward",
    );
  });

  it("allows small smooth-wheel deltas to accumulate before turning", () => {
    expect(getReaderWheelIntentFromDelta(12)).toBeNull();
    expect(getReaderWheelIntentFromDelta(36)).toBeNull();
    expect(getReaderWheelIntentFromDelta(READER_WHEEL_TURN_DELTA)).toBe(
      "forward",
    );
    expect(getReaderWheelIntentFromDelta(-READER_WHEEL_TURN_DELTA)).toBe(
      "backward",
    );
  });

  it("ignores modified wheel gestures", () => {
    expect(getReaderWheelDelta(wheelEvent({ ctrlKey: true, deltaY: 80 }))).toBeNull();
    expect(getReaderWheelDelta(wheelEvent({ metaKey: true, deltaY: 80 }))).toBeNull();
  });

  it("throttles wheel page turns", () => {
    expect(canRunReaderWheelTurn(1000, 1000)).toBe(false);
    expect(canRunReaderWheelTurn(1000 + READER_WHEEL_THROTTLE_MS, 1000)).toBe(
      true,
    );
  });
});
