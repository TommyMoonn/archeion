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
      "Highlight and add note",
    ]);
    expect(container.querySelector(".reader-highlight-menu")?.getAttribute("data-placement")).toBe(
      "above",
    );
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
    expect(onDismiss).toHaveBeenCalledTimes(1);
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
});
