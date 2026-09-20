import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const landingHtml = fs.readFileSync(path.join(process.cwd(), "docs/index.html"), "utf8");
const landingScript = fs.readFileSync(path.join(process.cwd(), "docs/js/main.js"), "utf8");

function createReaderDemoWindow() {
  const window = new Window({ url: "https://archeion.test/" });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });

  const body = landingHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (!body) throw new Error("Landing page body was not found.");
  window.document.body.innerHTML = body;

  window.eval(landingScript);

  const target = window.document.querySelector<HTMLElement>("[data-reader-annotatable]");
  const palette = window.document.querySelector<HTMLElement>("[data-reader-highlight-palette]");
  const colorButtons = Array.from(
    window.document.querySelectorAll<HTMLButtonElement>("[data-highlight-color]"),
  );
  const noteButton = window.document.querySelector<HTMLButtonElement>("[data-reader-note-action]");
  const hint = window.document.querySelector<HTMLElement>("[data-reader-annotation-hint]");

  if (!target || !palette || colorButtons.length !== 5 || !noteButton || !hint) {
    throw new Error("Landing Reader demo fixture did not initialize correctly.");
  }

  return { window, target, palette, colorButtons, noteButton, hint };
}

function openWithKeyboard(window: Window, target: HTMLElement, key: "Enter" | " ") {
  target.focus();
  target.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key }));
}

describe("landing Reader highlight demo keyboard contract", () => {
  it("uses a simple named button group and input-neutral instruction copy", () => {
    const { palette, colorButtons, noteButton, hint } = createReaderDemoWindow();

    expect(hint.textContent?.trim()).toBe("Select a passage to highlight it");
    expect(palette.getAttribute("role")).toBe("group");
    expect(palette.getAttribute("aria-label")).toBe("Highlight passage");
    expect(palette.querySelector('[role="menuitemradio"], [role="menuitem"]')).toBeNull();
    expect(noteButton.getAttribute("role")).toBeNull();

    for (const button of colorButtons.slice(0, 4)) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    expect(colorButtons[4].getAttribute("aria-pressed")).toBeNull();
  });

  it.each(["Enter", " "] as const)(
    "opens from %s and moves focus to the first color action",
    (key) => {
      const { window, target, palette, colorButtons } = createReaderDemoWindow();

      openWithKeyboard(window, target, key);

      expect(palette.hidden).toBe(false);
      expect(target.getAttribute("aria-expanded")).toBe("true");
      expect(window.document.activeElement).toBe(colorButtons[0]);
    },
  );

  it("restores the invoking passage after a color is selected and focuses that color on reopen", () => {
    const { window, target, palette, colorButtons } = createReaderDemoWindow();
    const green = colorButtons[1];

    target.focus();
    target.click();
    green.focus();
    green.click();

    expect(palette.hidden).toBe(true);
    expect(window.document.activeElement).toBe(target);
    expect(target.dataset.highlight).toBe("green");

    target.click();

    expect(green.getAttribute("aria-pressed")).toBe("true");
    expect(colorButtons[0].getAttribute("aria-pressed")).toBe("false");
    expect(window.document.activeElement).toBe(green);
  });

  it("restores the invoking passage when Escape dismisses the palette", () => {
    const { window, target, palette, colorButtons } = createReaderDemoWindow();

    target.focus();
    target.click();
    colorButtons[0].focus();
    window.document.dispatchEvent(
      new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );

    expect(palette.hidden).toBe(true);
    expect(window.document.activeElement).toBe(target);
  });

  it("never leaves focus on a hidden palette control after outside-pointer dismissal", () => {
    const { window, target, palette, colorButtons } = createReaderDemoWindow();
    const outside = window.document.querySelector<HTMLElement>("[data-reader-annotations-toggle]");
    if (!outside) throw new Error("Reader toolbar fixture did not initialize correctly.");

    target.focus();
    target.click();
    colorButtons[0].focus();
    outside.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));

    expect(palette.hidden).toBe(true);
    expect(window.document.activeElement).toBe(target);
  });
});
