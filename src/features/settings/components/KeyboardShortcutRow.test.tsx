// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../components/Tooltip";
import { KeyboardShortcutRow } from "./KeyboardShortcutRow";

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("KeyboardShortcutRow", () => {
  it("exposes the binding and routes each named action independently", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const onReset = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <TooltipProvider>
          <KeyboardShortcutRow
            bindingLabel="Ctrl + Shift + P"
            label="Open command palette"
            onChange={onChange}
            onClear={onClear}
            onReset={onReset}
          />
        </TooltipProvider>,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Change shortcut for Open command palette"]',
    );
    expect(button?.textContent).toContain("Ctrl + Shift + P");

    act(() => button?.click());
    expect(onChange).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Clear shortcut for Open command palette"]',
        )
        ?.click(),
    );
    expect(onClear).toHaveBeenCalledOnce();
    expect(onReset).not.toHaveBeenCalled();

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Reset Open command palette to default"]',
        )
        ?.click(),
    );
    expect(onReset).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
  });
});
