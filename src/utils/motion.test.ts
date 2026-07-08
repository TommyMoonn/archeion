// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  getProgrammaticScrollBehavior,
  isAppMotionEnabled,
} from "./motion";

describe("motion utilities", () => {
  afterEach(() => {
    delete document.documentElement.dataset.motion;
  });

  it("treats motion as disabled unless the root explicitly enables it", () => {
    expect(isAppMotionEnabled()).toBe(false);
    expect(getProgrammaticScrollBehavior()).toBe("auto");
  });

  it("uses smooth programmatic scrolling only when app motion is enabled", () => {
    document.documentElement.dataset.motion = "on";

    expect(isAppMotionEnabled()).toBe(true);
    expect(getProgrammaticScrollBehavior()).toBe("smooth");
  });
});
