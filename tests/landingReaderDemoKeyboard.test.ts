import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

const landingHtml = fs.readFileSync(path.join(process.cwd(), "docs/index.html"), "utf8");
const landingScript = fs.readFileSync(path.join(process.cwd(), "docs/js/main.js"), "utf8");

const windows: Window[] = [];

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

function createReaderDemoWindow(initialize?: (window: Window) => void) {
  const window = new Window({ url: "https://archeion.test/" });
  windows.push(window);

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
  initialize?.(window);

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
  it("keeps passage text as the identity while highlight and note guidance is described separately", () => {
    const { window, target, colorButtons, noteButton } = createReaderDemoWindow();
    const quote = target.textContent;
    const description = () => {
      expect(target.getAttribute("aria-label")).toBeNull();
      expect(target.getAttribute("aria-labelledby")).toBeNull();
      expect(target.textContent).toBe(quote);
      const id = target.getAttribute("aria-describedby");
      expect(id).toBeTruthy();
      expect(
        window.document
          .querySelector("[data-reader-page-copy]")
          ?.contains(window.document.getElementById(id!)),
      ).toBe(false);
      return window.document.getElementById(id!)?.textContent;
    };
    expect(description()).toBe("Select to highlight this passage or add a note.");
    target.click();
    colorButtons[1].click();
    expect(description()).toBe("Green highlight. Select to change the highlight or add a note.");
    target.click();
    noteButton.click();
    const input = window.document.querySelector<HTMLTextAreaElement>("[data-reader-note-input]")!;
    input.value = "Fixture note";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(description()).toBe(
      "Green highlight with note. Select to change the highlight or edit the note.",
    );
    window.document.querySelector<HTMLButtonElement>("[data-reader-note-delete]")!.click();
    expect(description()).toBe("Green highlight. Select to change the highlight or add a note.");
    target.click();
    colorButtons[4].click();
    expect(description()).toBe("Select to highlight this passage or add a note.");
  });

  it("describes every demo page without replacing its passage text or retaining old descriptions", () => {
    const { window } = createReaderDemoWindow();
    const previous = window.document.querySelector<HTMLButtonElement>(
      '[data-reader-page="previous"]',
    )!;
    const next = window.document.querySelector<HTMLButtonElement>('[data-reader-page="next"]')!;
    previous.click();
    for (let index = 0; index < 4; index++) {
      const passage = window.document.querySelector<HTMLElement>("[data-reader-annotatable]")!;
      expect(passage.textContent?.trim()).toBeTruthy();
      expect(passage.getAttribute("aria-label")).toBeNull();
      const descriptionId = passage.getAttribute("aria-describedby")!;
      expect(window.document.getElementById(descriptionId)?.textContent).toContain(
        "highlight this passage",
      );
      expect(window.document.querySelectorAll("[data-reader-passage-description]")).toHaveLength(1);
      next.click();
    }
  });

  it("keeps bookmark identity stable through toggles and page changes", () => {
    const { window } = createReaderDemoWindow();
    const bookmark = window.document.querySelector<HTMLButtonElement>(
      "[data-reader-bookmark-toggle]",
    )!;
    for (const pressed of [false, true, false]) {
      expect(bookmark.getAttribute("aria-label")).toBe("Bookmark");
      expect(bookmark.getAttribute("aria-pressed")).toBe(String(pressed));
      bookmark.click();
    }
    window.document.querySelector<HTMLButtonElement>('[data-reader-page="previous"]')!.click();
    expect(bookmark.getAttribute("aria-label")).toBe("Bookmark");
    expect(bookmark.getAttribute("aria-pressed")).toBe("true");
  });

  it("exposes one selected theme and supports radio-group keyboard navigation", () => {
    const { window } = createReaderDemoWindow();
    const group = window.document.querySelector('[aria-label="Reader theme"]')!;
    const themes = Array.from(group.querySelectorAll<HTMLButtonElement>("[data-reader-theme]"));
    expect(group.getAttribute("role")).toBe("radiogroup");
    const assertSelected = (theme: string) => {
      expect(group.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
      expect(themes.filter((button) => button.tabIndex === 0)).toHaveLength(1);
      for (const button of themes) {
        expect(button.getAttribute("aria-checked")).toBe(
          String(button.dataset.readerTheme === theme),
        );
        expect(button.classList.contains("active")).toBe(button.dataset.readerTheme === theme);
      }
      expect(window.document.querySelector("[data-reader-demo]")?.getAttribute("data-theme")).toBe(
        theme,
      );
    };
    assertSelected("dark");
    themes[2].click();
    assertSelected("light");
    for (const [key, theme] of [
      ["ArrowRight", "dark"],
      ["ArrowLeft", "light"],
      ["Home", "dark"],
      ["End", "light"],
      ["ArrowUp", "sepia"],
      ["ArrowDown", "light"],
    ]) {
      const selected = themes.find((button) => button.tabIndex === 0)!;
      selected.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, key, cancelable: true }),
      );
      assertSelected(theme);
      expect(window.document.activeElement).toBe(
        themes.find((button) => button.dataset.readerTheme === theme),
      );
    }
  });

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
