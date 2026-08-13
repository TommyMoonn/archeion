// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderHighlightPalette } from "./ReaderHighlightPalette";

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ReaderHighlightPalette", () => {
  it("always presents four colors and no-highlight as one palette", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{ bottom: 30, height: 10, left: 4, right: 34, top: 20, width: 30 }}
          busy={false}
          noteActionLabel="Highlight and add note"
          onChoose={vi.fn()}
          onDismiss={vi.fn()}
          onNote={vi.fn()}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll("button"), (button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual([
      "yellow highlight",
      "green highlight",
      "blue highlight",
      "rose highlight",
      "No color",
      "Define",
      "Highlight and add note",
    ]);
    expect(container.querySelector(".reader-highlight-menu")?.getAttribute("data-placement")).toBe(
      "above",
    );
  });

  it("keeps Define operable while annotation actions are busy", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onChoose = vi.fn();
    const onDefine = vi.fn();
    const onNote = vi.fn();

    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{ bottom: 130, height: 20, left: 100, right: 180, top: 110, width: 80 }}
          busy
          defineAvailable
          noteActionLabel="Add note"
          onChoose={onChoose}
          onDefine={onDefine}
          onDismiss={vi.fn()}
          onNote={onNote}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    const defineAction = container.querySelector<HTMLButtonElement>('[aria-label="Define"]');
    expect(defineAction?.disabled).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="yellow highlight"]')?.disabled,
    ).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Add note"]')?.disabled).toBe(
      true,
    );
    expect(
      container.querySelector('[aria-label="Highlight color"]')?.hasAttribute("aria-busy"),
    ).toBe(false);

    act(() => defineAction?.click());

    expect(onDefine).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
    expect(onNote).not.toHaveBeenCalled();
  });

  it("keeps annotation actions operable while dictionary lookup is busy", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onChoose = vi.fn();
    const onDefine = vi.fn();
    const onNote = vi.fn();

    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{ bottom: 130, height: 20, left: 100, right: 180, top: 110, width: 80 }}
          busy={false}
          defineAvailable
          defineBusy
          noteActionLabel="Add note"
          onChoose={onChoose}
          onDefine={onDefine}
          onDismiss={vi.fn()}
          onNote={onNote}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    const defineAction = container.querySelector<HTMLButtonElement>('[aria-label="Define"]');
    const highlightAction = container.querySelector<HTMLButtonElement>(
      '[aria-label="yellow highlight"]',
    );
    const noteAction = container.querySelector<HTMLButtonElement>('[aria-label="Add note"]');
    expect(defineAction?.disabled).toBe(true);
    expect(highlightAction?.disabled).toBe(false);
    expect(noteAction?.disabled).toBe(false);
    expect(
      container.querySelector('[aria-label="Highlight color"]')?.hasAttribute("aria-busy"),
    ).toBe(false);

    act(() => {
      highlightAction?.click();
      noteAction?.click();
    });

    expect(onChoose).toHaveBeenCalledWith("yellow");
    expect(onNote).toHaveBeenCalledOnce();
    expect(onDefine).not.toHaveBeenCalled();
  });

  it("exposes dictionary management as the current action when lookup is unavailable", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onDefine = vi.fn();

    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{ bottom: 130, height: 20, left: 100, right: 180, top: 110, width: 80 }}
          busy={false}
          defineAvailable
          defineLabel="Manage dictionaries"
          noteActionLabel="Add note"
          onChoose={vi.fn()}
          onDefine={onDefine}
          onDismiss={vi.fn()}
          onNote={vi.fn()}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    const action = container.querySelector<HTMLButtonElement>('[aria-label="Manage dictionaries"]');
    expect(action).toBeInstanceOf(HTMLButtonElement);
    act(() => action?.click());
    expect(onDefine).toHaveBeenCalledOnce();
  });

  it("closes on Escape while focus is inside the palette", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onDismiss = vi.fn();
    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{ bottom: 130, height: 20, left: 100, right: 180, top: 110, width: 80 }}
          busy={false}
          noteActionLabel="Add note"
          onChoose={vi.fn()}
          onDismiss={onDismiss}
          onNote={vi.fn()}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    act(() =>
      container
        .querySelector<HTMLElement>('[aria-label="Highlight color"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    expect(onDismiss).toHaveBeenCalledWith(true);
  });

  it("dismisses one parent outside pointer once without restoring EPUB focus", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onDismiss = vi.fn();
    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{ bottom: 130, height: 20, left: 100, right: 180, top: 110, width: 80 }}
          busy={false}
          noteActionLabel="Add note"
          onChoose={vi.fn()}
          onDismiss={onDismiss}
          onNote={vi.fn()}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith(false);
  });

  it("declines invalid geometry without writing non-finite styles", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{
            bottom: 30,
            height: 10,
            left: Number.NaN,
            right: 34,
            top: 20,
            width: 30,
          }}
          busy={false}
          noteActionLabel="Add note"
          onChoose={vi.fn()}
          onDismiss={vi.fn()}
          onNote={vi.fn()}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    expect(container.querySelector(".reader-highlight-menu")).toBeNull();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("invalid value for the `left` css style property"),
    );
  });

  it("names existing-note editing and attached-note removal explicitly", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{ bottom: 130, height: 20, left: 100, right: 180, top: 110, width: 80 }}
          busy={false}
          hasAttachedNote
          noteActionLabel="Edit note"
          onChoose={vi.fn()}
          onDismiss={vi.fn()}
          onNote={vi.fn()}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    expect(container.querySelector('[aria-label="Edit note"]')).toBeInstanceOf(HTMLButtonElement);
    expect(
      container.querySelector('[aria-label="No color — remove highlight and attached note"]'),
    ).toBeInstanceOf(HTMLButtonElement);
  });

  it("announces No color as removal for an existing highlight without a note", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{ bottom: 130, height: 20, left: 100, right: 180, top: 110, width: 80 }}
          busy={false}
          noteActionLabel="Add note"
          onChoose={vi.fn()}
          onDismiss={vi.fn()}
          onNote={vi.fn()}
          selectedColor="blue"
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    expect(container.querySelector('[aria-label="No color — remove highlight"]')).toBeInstanceOf(
      HTMLButtonElement,
    );
  });

  it("supports wrapped arrow, Home, and End navigation across enabled palette actions", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <ReaderHighlightPalette
          anchorRect={{ bottom: 130, height: 20, left: 100, right: 180, top: 110, width: 80 }}
          busy={false}
          noteActionLabel="Add note"
          onChoose={vi.fn()}
          onDismiss={vi.fn()}
          onNote={vi.fn()}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    const palette = container.querySelector<HTMLElement>('[aria-label="Highlight color"]')!;
    const actions = Array.from(palette.querySelectorAll<HTMLButtonElement>("button"));
    actions[0]?.focus();
    act(() =>
      actions[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" }),
      ),
    );
    expect(document.activeElement).toBe(actions.at(-1));

    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Home" }),
      ),
    );
    expect(document.activeElement).toBe(actions[0]);

    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End" }),
      ),
    );
    expect(document.activeElement).toBe(actions.at(-1));
  });
});
