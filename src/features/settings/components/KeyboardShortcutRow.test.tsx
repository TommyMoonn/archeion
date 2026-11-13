// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../components/Tooltip";
import { KeyboardShortcutRow } from "./KeyboardShortcutRow";

let root: Root | null = null;

afterEach(() => {
  vi.useRealTimers();
  if (root) act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("KeyboardShortcutRow", () => {
  it("explains that the displayed key binding can be changed", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <TooltipProvider>
          <KeyboardShortcutRow
            bindingLabel="Ctrl + Shift + P"
            label="Open command palette"
            onChange={() => undefined}
          />
        </TooltipProvider>,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Change shortcut for Open command palette"]',
    );
    expect(button?.textContent).toContain("Ctrl + Shift + P");

    act(() => {
      const pointerEnter = new Event("pointerover", { bubbles: true });
      Object.defineProperty(pointerEnter, "pointerType", { value: "mouse" });
      button?.dispatchEvent(pointerEnter);
      vi.advanceTimersByTime(500);
    });

    expect(document.querySelector(".app-tooltip")?.textContent).toBe(
      "Change shortcut for Open command palette",
    );
  });
});
