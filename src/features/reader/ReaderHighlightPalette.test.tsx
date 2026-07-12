// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderHighlightPalette } from "./ReaderHighlightPalette";

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
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
          busy={false}
          onChoose={vi.fn()}
          onDismiss={vi.fn()}
          onNote={vi.fn()}
          x={4}
          y={20}
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
      "No highlight",
      "Add or edit note",
    ]);
    expect(container.querySelector(".reader-highlight-menu")?.getAttribute("data-placement")).toBe(
      "below",
    );
  });
});
