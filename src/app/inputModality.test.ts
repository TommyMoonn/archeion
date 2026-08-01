// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { FocusPresentationRuntime } from "./inputModality";

function dispatchKey(target: EventTarget, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-focus-presentation");
});

describe("FocusPresentationRuntime", () => {
  it("publishes pointer intent before pointer focus and removes its bounded owner", () => {
    const runtime = new FocusPresentationRuntime();
    const stop = runtime.start(document);
    const button = document.createElement("button");
    document.body.append(button);

    runtime.markKeyboardNavigation();
    button.addEventListener("pointerdown", () => {
      expect(document.documentElement.dataset.focusPresentation).toBe("pointer");
      button.focus();
    });
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(document.activeElement).toBe(button);
    expect(runtime.getIntent()).toBe("pointer");
    stop();
    stop();
    expect(document.documentElement.hasAttribute("data-focus-presentation")).toBe(false);
  });

  it("promotes keyboard navigation and control activation without treating typing as navigation", () => {
    const runtime = new FocusPresentationRuntime();
    const stop = runtime.start(document);
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);

    dispatchKey(input, "Tab", { shiftKey: true });
    expect(runtime.getIntent()).toBe("keyboard-navigation");

    runtime.markPointer();
    dispatchKey(input, "a");
    dispatchKey(input, "Enter");
    dispatchKey(input, " ");
    expect(runtime.getIntent()).toBe("pointer");

    dispatchKey(button, "Enter");
    expect(runtime.getIntent()).toBe("keyboard-navigation");

    runtime.markPointer();
    dispatchKey(button, " ");
    expect(runtime.getIntent()).toBe("keyboard-navigation");
    stop();
  });

  it("does not infer focus movement from a prevented directional key", () => {
    const runtime = new FocusPresentationRuntime();
    const stop = runtime.start(document);
    const tree = document.createElement("div");
    document.body.append(tree);

    dispatchKey(tree, "ArrowDown");
    expect(runtime.getIntent()).toBe("pointer");

    tree.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") event.preventDefault();
    });
    dispatchKey(tree, "ArrowDown");
    expect(runtime.getIntent()).toBe("pointer");
    stop();
  });

  it("does not change presentation for Escape, modifier-only keys, or programmatic focus", () => {
    const runtime = new FocusPresentationRuntime();
    const stop = runtime.start(document);
    const button = document.createElement("button");
    document.body.append(button);

    dispatchKey(button, "Escape");
    dispatchKey(button, "Shift", { shiftKey: true });
    dispatchKey(button, "Control", { ctrlKey: true });
    button.focus();

    expect(runtime.getIntent()).toBe("pointer");
    stop();
  });

  it("shares one document owner and rejects a competing application document", () => {
    const runtime = new FocusPresentationRuntime();
    const stopFirst = runtime.start(document);
    const stopSecond = runtime.start(document);
    const otherDocument = document.implementation.createHTMLDocument();

    expect(() => runtime.start(otherDocument)).toThrow(
      "Focus presentation already belongs to another application document.",
    );

    stopFirst();
    expect(document.documentElement.dataset.focusPresentation).toBe("pointer");
    stopSecond();
    expect(document.documentElement.hasAttribute("data-focus-presentation")).toBe(false);
  });

  it("distinguishes keyboard commands and programmatic focus from navigation", () => {
    const runtime = new FocusPresentationRuntime();
    const stop = runtime.start(document);
    const button = document.createElement("button");
    document.body.append(button);

    runtime.markKeyboardCommand();
    expect(runtime.getIntent()).toBe("keyboard-command");
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-command");

    runtime.markProgrammatic();
    button.focus();
    expect(runtime.getIntent()).toBe("programmatic");

    const ownedActivation = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    ownedActivation.preventDefault();
    button.dispatchEvent(ownedActivation);
    expect(runtime.getIntent()).toBe("keyboard-navigation");
    stop();
  });
});
