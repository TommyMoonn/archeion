// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickActionsPalette } from "./QuickActionsPalette";
import { QuickActionsRegistry, type QuickActionRegistration } from "./quickActions";
import { focusPresentationRuntime } from "../../app/inputModality";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressKey(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
}

function createCommand(
  id: string,
  label: string,
  overrides: Partial<QuickActionRegistration> = {},
): QuickActionRegistration {
  return {
    configuration: "unbound",
    execute: vi.fn(),
    group: "Library",
    id,
    label,
    scope: "global",
    ...overrides,
  };
}

async function renderPalette(commands: QuickActionRegistration[]) {
  const registry = new QuickActionsRegistry();
  registry.register("test", commands);
  const onClose = vi.fn();
  const onExecute = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <QuickActionsPalette
        keyboard={{ shortcuts: {} }}
        onClose={onClose}
        onExecute={onExecute}
        registry={registry}
      />,
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
  it("uses input-owned combobox semantics without result tab stops", async () => {
    const first = createCommand("first", "First action", { order: 1 });
    const second = createCommand("second", "Second action", { order: 2 });
    const rendered = await renderPalette([first, second]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const panel = rendered.container.querySelector<HTMLElement>(".quick-actions__panel")!;
    const listbox = rendered.container.querySelector<HTMLElement>('[role="listbox"]')!;
    const options = [...rendered.container.querySelectorAll<HTMLElement>('[role="option"]')];

    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    expect(options).toHaveLength(2);
    expect(options.every((option) => option.tagName === "DIV" && option.tabIndex === -1)).toBe(
      true,
    );
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect([...panel.children].map((child) => child.className)).toEqual([
      "quick-actions__search",
      "quick-actions__results",
      "quick-actions__footer",
    ]);
    expect(rendered.container.querySelector(".quick-actions__search > kbd")).toBeNull();
    expect(rendered.container.querySelector(".quick-actions__command strong")?.textContent).toBe(
      "Library: First action",
    );
    expect(rendered.container.querySelector(".quick-actions__command-group")).toBeNull();
  });

  it("executes the active available command once through Enter", async () => {
    const first = createCommand("first", "First action", { order: 1 });
    const second = createCommand("second", "Second action", { order: 2 });
    const rendered = await renderPalette([first, second]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => pressKey(input, "ArrowDown"));
    await act(async () => pressKey(input, "Enter"));

    expect(rendered.onExecute).toHaveBeenCalledOnce();
    expect(rendered.onExecute).toHaveBeenCalledWith(second);
  });

  it.each(["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"])(
    "keeps search focus and pointer presentation for %s active-command movement",
    async (key) => {
      const rendered = await renderPalette([
        createCommand("first", "First action", { order: 1 }),
        createCommand("second", "Second action", { order: 2 }),
      ]);
      const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
      const stopPresentation = focusPresentationRuntime.start(document);
      focusPresentationRuntime.markPointer();

      try {
        await act(async () => {
          pressKey(input, key);
        });

        expect(document.activeElement).toBe(input);
        expect(focusPresentationRuntime.getIntent()).toBe("pointer");
      } finally {
        stopPresentation();
      }
    },
  );

  it("updates active descendant for Arrow, Home, End, PageUp, and PageDown", async () => {
    const commands = Array.from({ length: 8 }, (_, index) =>
      createCommand(`command-${index}`, `Command ${index}`, { order: index }),
    );
    const rendered = await renderPalette(commands);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const results = rendered.container.querySelector<HTMLElement>(".quick-actions__results")!;
    const options = [...rendered.container.querySelectorAll<HTMLElement>('[role="option"]')];
    Object.defineProperty(results, "clientHeight", { configurable: true, value: 100 });
    for (const option of options) {
      option.getBoundingClientRect = () => new DOMRect(0, 0, 300, 50);
    }

    await act(async () => pressKey(input, "ArrowDown"));
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    await act(async () => pressKey(input, "End"));
    expect(input.getAttribute("aria-activedescendant")).toBe(options[7]?.id);
    await act(async () => pressKey(input, "PageUp"));
    expect(input.getAttribute("aria-activedescendant")).toBe(options[5]?.id);
    await act(async () => pressKey(input, "Home"));
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    await act(async () => pressKey(input, "PageDown"));
    expect(input.getAttribute("aria-activedescendant")).toBe(options[2]?.id);
    expect(document.activeElement).toBe(input);
  });

  it("keeps active-option scrolling inside the results region", async () => {
    const rendered = await renderPalette([
      createCommand("first", "First action", { order: 1 }),
      createCommand("second", "Second action", { order: 2 }),
    ]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const results = rendered.container.querySelector<HTMLElement>(".quick-actions__results")!;
    const options = [...rendered.container.querySelectorAll<HTMLElement>('[role="option"]')];
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    results.getBoundingClientRect = () => new DOMRect(0, 0, 300, 50);
    options[0]!.getBoundingClientRect = () => new DOMRect(0, 0, 300, 50);
    options[1]!.getBoundingClientRect = () => new DOMRect(0, 50, 300, 50);

    await act(async () => pressKey(input, "ArrowDown"));

    expect(results.scrollTop).toBe(50);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("lets pointer hover and click use an option without blurring search", async () => {
    const first = createCommand("first", "First action", { order: 1 });
    const second = createCommand("second", "Second action", { order: 2 });
    const rendered = await renderPalette([first, second]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const options = [...rendered.container.querySelectorAll<HTMLElement>('[role="option"]')];

    await act(async () => {
      options[1]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    expect(document.activeElement).toBe(input);

    await act(async () => {
      options[1]?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);

    await act(async () => {
      options[1]?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      options[1]?.click();
    });
    expect(document.activeElement).toBe(input);
    expect(rendered.onExecute).toHaveBeenCalledOnce();
    expect(rendered.onExecute).toHaveBeenCalledWith(second);
  });

  it("keeps disabled commands visible with a reason and does not execute them", async () => {
    const disabled = createCommand("disabled", "Open reader TOC", {
      availability: { available: false, reason: "Select a book first." },
    });
    const rendered = await renderPalette([disabled]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const option = rendered.container.querySelector<HTMLElement>('[role="option"]')!;
    const reasonId = option.getAttribute("aria-describedby")!;

    expect(rendered.container.textContent).toContain("Select a book first.");
    expect(option.getAttribute("aria-disabled")).toBe("true");
    expect(option.getAttribute("aria-label")).toContain("Library: Open reader TOC");
    expect(document.getElementById(reasonId)?.textContent).toBe("Select a book first.");

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(rendered.onExecute).not.toHaveBeenCalled();

    await act(async () => option.click());
    expect(rendered.onExecute).not.toHaveBeenCalled();
  });

  it("includes the visible shortcut in the active option name", async () => {
    const rendered = await renderPalette([
      createCommand("shortcut", "Open shortcut", {
        configuration: "fixed",
        defaultBinding: { alt: false, key: "k", primary: true, shift: true },
      }),
    ]);
    const option = rendered.container.querySelector<HTMLElement>('[role="option"]')!;

    expect(option.getAttribute("aria-label")).toMatch(
      /^Library: Open shortcut, (?:Ctrl|Command)\+Shift\+K$/,
    );
  });

  it("filters locally and reports an actionable empty state", async () => {
    const rendered = await renderPalette([createCommand("search", "Search books")]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => setInputValue(input, "does not exist"));

    expect(input.value).toBe("does not exist");
    expect(document.activeElement).toBe(input);
    expect(rendered.container.textContent).toContain("No matching commands");
    expect(rendered.container.textContent).toContain("Try a shorter action or destination.");
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain(
      "No matching commands",
    );
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("announces result counts through one stable polite status", async () => {
    const rendered = await renderPalette([
      createCommand("first", "First action"),
      createCommand("second", "Second action"),
    ]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const status = rendered.container.querySelector<HTMLElement>('[role="status"]')!;

    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("2 commands available.");
    await act(async () => setInputValue(input, "First"));
    expect(rendered.container.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toContain("1 command available.");
  });

  it("resets query navigation and bounds the active option when results shrink", async () => {
    const first = createCommand("first", "Open Library", { order: 1 });
    const second = createCommand("second", "Open Settings", { order: 2 });
    const rendered = await renderPalette([first, second]);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => pressKey(input, "End"));
    expect(input.getAttribute("aria-activedescendant")).toContain("second");

    await act(async () => setInputValue(input, "Open"));
    expect(input.getAttribute("aria-activedescendant")).toContain("first");

    await act(async () => pressKey(input, "End"));
    await act(async () => {
      rendered.registry.register("test", [first]);
    });
    expect(input.getAttribute("aria-activedescendant")).toContain("first");
    expect(rendered.container.querySelectorAll('[role="option"]')).toHaveLength(1);
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
