// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickActionsPalette } from "./QuickActionsPalette";
import { QuickActionsRegistry, type QuickActionCommand } from "./quickActions";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function createCommand(
  id: string,
  label: string,
  overrides: Partial<QuickActionCommand> = {},
): QuickActionCommand {
  return {
    execute: vi.fn(),
    group: "Library",
    id,
    label,
    ...overrides,
  };
}

async function renderPalette(commands: QuickActionCommand[]) {
  const registry = new QuickActionsRegistry();
  registry.register("test", commands);
  const onClose = vi.fn();
  const onExecute = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <QuickActionsPalette onClose={onClose} onExecute={onExecute} registry={registry} />,
    );
  });

  return { container, onClose, onExecute, registry };
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe("QuickActionsPalette", () => {
  it("focuses search and executes the keyboard-selected enabled command", async () => {
    const first = createCommand("first", "First action", { order: 1 });
    const second = createCommand("second", "Second action", { order: 2 });
    const rendered = await renderPalette([first, second]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    expect(document.activeElement).toBe(input);

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(rendered.onExecute).toHaveBeenCalledWith(second);
  });

  it("keeps disabled commands visible with a reason and does not execute them", async () => {
    const disabled = createCommand("disabled", "Open reader TOC", {
      disabledReason: "Open a book to use its table of contents.",
    });
    const rendered = await renderPalette([disabled]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    expect(rendered.container.textContent).toContain("Open a book to use its table of contents.");

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(rendered.onExecute).not.toHaveBeenCalled();
  });

  it("filters locally and reports an actionable empty state", async () => {
    const rendered = await renderPalette([createCommand("search", "Search books")]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => setInputValue(input, "does not exist"));

    expect(rendered.container.textContent).toContain("No matching commands");
    expect(rendered.container.textContent).toContain("Try a shorter action or destination.");
  });

  it("closes on Escape without executing a command", async () => {
    const rendered = await renderPalette([createCommand("search", "Search books")]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(rendered.onClose).toHaveBeenCalledTimes(1);
    expect(rendered.onExecute).not.toHaveBeenCalled();
  });
});
