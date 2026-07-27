// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { InputModalityRuntime } from "./inputModality";

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
  document.documentElement.removeAttribute("data-input-modality");
});

describe("InputModalityRuntime", () => {
  it("publishes pointer intent before pointer focus and removes its bounded owner", () => {
    const runtime = new InputModalityRuntime();
    const stop = runtime.start(document);
    const button = document.createElement("button");
    document.body.append(button);

    runtime.markKeyboard();
    button.addEventListener("pointerdown", () => {
      expect(document.documentElement.dataset.inputModality).toBe("pointer");
      button.focus();
    });
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(document.activeElement).toBe(button);
    expect(runtime.getModality()).toBe("pointer");
    stop();
    stop();
    expect(document.documentElement.hasAttribute("data-input-modality")).toBe(false);
  });

  it("promotes keyboard navigation and control activation without treating typing as navigation", () => {
    const runtime = new InputModalityRuntime();
    const stop = runtime.start(document);
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);

    dispatchKey(input, "Tab", { shiftKey: true });
    expect(runtime.getModality()).toBe("keyboard");

    runtime.markPointer();
    dispatchKey(input, "a");
    dispatchKey(input, "Enter");
    dispatchKey(input, " ");
    expect(runtime.getModality()).toBe("pointer");

    dispatchKey(button, "Enter");
    expect(runtime.getModality()).toBe("keyboard");

    runtime.markPointer();
    dispatchKey(button, " ");
    expect(runtime.getModality()).toBe("keyboard");
    stop();
  });

  it("promotes only directional keys owned by a focus-navigation handler", () => {
    const runtime = new InputModalityRuntime();
    const stop = runtime.start(document);
    const tree = document.createElement("div");
    document.body.append(tree);

    dispatchKey(tree, "ArrowDown");
    expect(runtime.getModality()).toBe("pointer");

    tree.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") event.preventDefault();
    });
    dispatchKey(tree, "ArrowDown");
    expect(runtime.getModality()).toBe("keyboard");
    stop();
  });

  it("does not change modality for Escape, modifier-only keys, or programmatic focus", () => {
    const runtime = new InputModalityRuntime();
    const stop = runtime.start(document);
    const button = document.createElement("button");
    document.body.append(button);

    dispatchKey(button, "Escape");
    dispatchKey(button, "Shift", { shiftKey: true });
    dispatchKey(button, "Control", { ctrlKey: true });
    button.focus();

    expect(runtime.getModality()).toBe("pointer");
    stop();
  });

  it("shares one document owner and rejects a competing application document", () => {
    const runtime = new InputModalityRuntime();
    const stopFirst = runtime.start(document);
    const stopSecond = runtime.start(document);
    const otherDocument = document.implementation.createHTMLDocument();

    expect(() => runtime.start(otherDocument)).toThrow(
      "Input modality already belongs to another application document.",
    );

    stopFirst();
    expect(document.documentElement.dataset.inputModality).toBe("pointer");
    stopSecond();
    expect(document.documentElement.hasAttribute("data-input-modality")).toBe(false);
  });
});
