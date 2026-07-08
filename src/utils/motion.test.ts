// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getProgrammaticScrollBehavior,
  isAppMotionEnabled,
  isReducedMotionPreferred,
  scrollElementToTop,
} from "./motion";

const originalMatchMedia = window.matchMedia;

function restoreMatchMedia() {
  if (originalMatchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
    return;
  }

  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
}

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

describe("motion utilities", () => {
  afterEach(() => {
    delete document.documentElement.dataset.motion;
    restoreMatchMedia();
    vi.restoreAllMocks();
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

  it("uses instant programmatic scrolling when reduced motion is preferred", () => {
    document.documentElement.dataset.motion = "on";
    mockReducedMotion(true);

    expect(isReducedMotionPreferred()).toBe(true);
    expect(isAppMotionEnabled()).toBe(false);
    expect(getProgrammaticScrollBehavior()).toBe("auto");
  });

  it("scrolls the provided content owner to the top", () => {
    document.documentElement.dataset.motion = "on";
    const element = document.createElement("main");
    const scrollTo = vi.fn();
    element.scrollTo = scrollTo;

    scrollElementToTop(element);

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 0 });
  });

  it("falls back to scrollTop when scrollTo is unavailable", () => {
    const element = document.createElement("main");
    element.scrollTop = 120;
    Object.defineProperty(element, "scrollTo", {
      configurable: true,
      value: undefined,
    });

    scrollElementToTop(element);

    expect(element.scrollTop).toBe(0);
  });
});
