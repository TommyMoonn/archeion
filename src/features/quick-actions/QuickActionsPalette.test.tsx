// @vitest-environment happy-dom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickActionsPalette } from "./QuickActionsPalette";
import { QuickActionsRegistry, type QuickActionRegistration } from "./quickActions";
import { QuickActionChildModeSession, type QuickActionPaletteOutcome } from "./quickActionModes";
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

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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

async function renderPalette(
  commands: QuickActionRegistration[],
  execute?: (
    command: QuickActionRegistration,
  ) => Promise<QuickActionPaletteOutcome> | QuickActionPaletteOutcome,
  options: { strictMode?: boolean } = {},
) {
  const registry = new QuickActionsRegistry();
  registry.register("test", commands);
  const onClose = vi.fn();
  const onExecute = vi.fn(execute ?? (() => ({ kind: "close" as const })));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const palette = (
    <QuickActionsPalette
      keyboard={{ shortcuts: {} }}
      onClose={onClose}
      onExecute={onExecute}
      registry={registry}
    />
  );

  await act(async () => {
    root?.render(options.strictMode ? <StrictMode>{palette}</StrictMode> : palette);
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
    expect(rendered.container.querySelector('input[type="search"]')).toBe(input);
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
    act(() => pressKey(input, "Enter"));

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

  it("enters a child mode and restores the root query and active command on Escape", async () => {
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "archives",
      placeholder: "Search archives…",
      snapshot: {
        committedOptionId: "books",
        options: [
          { id: "books", label: "Books", status: "Current archive" },
          { id: "comics", label: "Comics" },
        ],
      },
      title: "Switch archive",
    });
    const switchCommand = createCommand("archive.switch", "Switch archive…", {
      group: "Archive",
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([switchCommand], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => setInputValue(input, "Switch"));
    const rootActiveDescendant = input.getAttribute("aria-activedescendant");
    await act(async () => pressKey(input, "Enter"));

    expect(document.activeElement).toBe(input);
    expect(rendered.container.querySelector('input[type="search"]')).toBe(input);
    expect(input.placeholder).toBe("Search archives…");
    expect(rendered.container.querySelector(".quick-actions__mode-heading")).toBeNull();
    expect(rendered.container.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe(
      "Switch archive",
    );
    expect(rendered.container.textContent).toContain("Current archive");

    await act(async () => pressKey(input, "Escape"));

    expect(rendered.onClose).not.toHaveBeenCalled();
    expect(input.placeholder).toBe("Type a command…");
    expect(input.value).toBe("Switch");
    expect(input.getAttribute("aria-activedescendant")).toBe(rootActiveDescendant);
    await act(async () => pressKey(input, "Escape"));
    expect(rendered.onClose).toHaveBeenCalledOnce();
  });

  it("starts on the mode-owned initial option and previews keyboard and pointer movement", async () => {
    const preview = vi.fn();
    const confirm = vi.fn(() => ({ kind: "keep-open" as const }));
    const mode = new QuickActionChildModeSession({
      confirm,
      id: "themes",
      placeholder: "Change theme…",
      preview,
      snapshot: {
        committedOptionId: "light",
        initialActiveOptionId: "light",
        options: [
          { id: "dark", label: "Archeion Dark" },
          { id: "light", label: "Archeion Light", status: "Current theme" },
          { id: "custom", label: "Custom theme" },
        ],
      },
      title: "Change theme",
    });
    const command = createCommand("appearance.change-theme", "Change theme…", {
      group: "Appearance",
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => pressKey(input, "Enter"));
    expect(input.getAttribute("aria-activedescendant")).toContain("light");
    expect(preview).toHaveBeenLastCalledWith("light");
    expect(document.activeElement).toBe(input);

    await act(async () => pressKey(input, "ArrowDown"));
    expect(preview).toHaveBeenLastCalledWith("custom");
    expect(confirm).not.toHaveBeenCalled();

    const dark = [...rendered.container.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.getAttribute("aria-label") === "Archeion Dark",
    )!;
    await act(async () => dark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(preview).toHaveBeenLastCalledWith("dark");
    expect(confirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);

    await act(async () => dark.click());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: "dark" }));
  });

  it("retains staged-mode ownership after Strict Mode effect replay", async () => {
    const onDispose = vi.fn();
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "keep-open" }),
      id: "strict-mode",
      onDispose,
      placeholder: "Search strict options…",
      snapshot: { options: [{ id: "owned", label: "Owned option" }] },
      title: "Strict mode child",
    });
    const command = createCommand("strict-mode", "Open strict mode", {
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const focus = vi.spyOn(HTMLInputElement.prototype, "focus");
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }), {
      strictMode: true,
    });
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const recordRecent = vi.spyOn(rendered.registry, "recordRecent");

    expect(focus.mock.calls.length).toBeGreaterThanOrEqual(2);
    await act(async () => pressKey(input, "Enter"));

    expect(input.placeholder).toBe("Search strict options…");
    expect(rendered.container.textContent).toContain("Owned option");
    expect(onDispose).not.toHaveBeenCalled();
    expect(recordRecent).toHaveBeenCalledOnce();

    act(() => root?.unmount());
    root = null;
    expect(onDispose).toHaveBeenCalledOnce();
  });

  it("disposes a late staged outcome after a real Strict Mode unmount without recording it", async () => {
    const pending = deferred<QuickActionPaletteOutcome>();
    const onDispose = vi.fn();
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "late-strict-mode",
      onDispose,
      placeholder: "Search late options…",
      snapshot: { options: [{ id: "late", label: "Late option" }] },
      title: "Late strict mode child",
    });
    const command = createCommand("late-strict-mode", "Open late strict mode", {
      runInPalette: () => pending.promise,
    });
    const rendered = await renderPalette([command], () => pending.promise, { strictMode: true });
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const recordRecent = vi.spyOn(rendered.registry, "recordRecent");

    act(() => pressKey(input, "Enter"));
    act(() => root?.unmount());
    root = null;
    await act(async () => {
      pending.resolve({ kind: "child-mode", mode });
      await pending.promise;
    });

    expect(onDispose).toHaveBeenCalledOnce();
    expect(recordRecent).not.toHaveBeenCalled();
  });

  it("does not record a staged command when mode construction throws", async () => {
    const command = createCommand("throwing-mode", "Open throwing mode", {
      runInPalette: () => {
        throw new Error("construction failed");
      },
    });
    const rendered = await renderPalette([command], () => {
      throw new Error("construction failed");
    });
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const recordRecent = vi.spyOn(rendered.registry, "recordRecent");

    act(() => pressKey(input, "Enter"));

    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be completed",
    );
    expect(recordRecent).not.toHaveBeenCalled();
  });

  it("returns from an empty child query with Backspace and disposes the mode once", async () => {
    const onDispose = vi.fn();
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "archives",
      onDispose,
      placeholder: "Search archives…",
      snapshot: { options: [{ id: "books", label: "Books" }] },
      title: "Switch archive",
    });
    const command = createCommand("archive.switch", "Switch archive…", {
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => pressKey(input, "Enter"));
    await act(async () => pressKey(input, "Backspace"));

    expect(input.placeholder).toBe("Type a command…");
    expect(onDispose).toHaveBeenCalledOnce();
  });

  it("preserves an active child option by id when options are replaced", async () => {
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "keep-open" }),
      id: "archives",
      placeholder: "Search archives…",
      snapshot: {
        options: [
          { id: "books", label: "Books" },
          { id: "comics", label: "Comics" },
        ],
      },
      title: "Switch archive",
    });
    const command = createCommand("archive.switch", "Switch archive…", {
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => pressKey(input, "Enter"));
    await act(async () => pressKey(input, "ArrowDown"));
    expect(input.getAttribute("aria-activedescendant")).toContain("comics");

    await act(async () => {
      mode.replaceOptions([
        { id: "novels", label: "Novels" },
        { id: "comics", label: "Comics updated" },
      ]);
    });

    expect(input.getAttribute("aria-activedescendant")).toContain("comics");
    expect(rendered.container.textContent).toContain("Comics updated");
  });

  it("derives generic committed state separately from active selection", async () => {
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "keep-open" }),
      id: "preferences",
      placeholder: "Search preferences…",
      snapshot: {
        committedOptionId: "comfortable",
        options: [
          { id: "compact", label: "Compact" },
          { id: "comfortable", label: "Comfortable", status: "Saved preference" },
        ],
      },
      title: "Choose density",
    });
    const command = createCommand("density", "Choose density", {
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    act(() => pressKey(input, "Enter"));

    const options = [...rendered.container.querySelectorAll<HTMLElement>('[role="option"]')];
    const active = options.find((option) => option.getAttribute("aria-selected") === "true")!;
    const committed = options.find((option) => option.dataset.committed === "true")!;
    const detailId = committed.getAttribute("aria-describedby")!;
    expect(active.getAttribute("aria-label")).toBe("Compact");
    expect(committed.getAttribute("aria-label")).toBe("Comfortable");
    expect(committed).not.toBe(active);
    expect(document.getElementById(detailId)?.textContent).toBe("Saved preference");
    expect(committed.textContent).toContain("Saved preference");
  });

  it("keeps a child mode open with owned feedback when confirmation fails", async () => {
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ error: "Archive could not be opened. Try again.", kind: "keep-open" }),
      id: "archives",
      placeholder: "Search archives…",
      snapshot: { options: [{ id: "comics", label: "Comics" }] },
      title: "Switch archive",
    });
    const command = createCommand("archive.switch", "Switch archive…", {
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => pressKey(input, "Enter"));
    await act(async () => pressKey(input, "Enter"));

    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Archive could not be opened",
    );
    expect(input.placeholder).toBe("Search archives…");
    expect(document.activeElement).toBe(input);
    expect(rendered.onClose).not.toHaveBeenCalled();
  });

  it("disposes an active mode once when the palette unmounts", async () => {
    const onDispose = vi.fn();
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "archives",
      onDispose,
      placeholder: "Search archives…",
      snapshot: { options: [{ id: "books", label: "Books" }] },
      title: "Switch archive",
    });
    const command = createCommand("archive.switch", "Switch archive…", {
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => pressKey(input, "Enter"));

    act(() => root?.unmount());
    root = null;

    expect(onDispose).toHaveBeenCalledOnce();
  });

  it("disposes an active mode once when the palette closes from its backdrop", async () => {
    const onDispose = vi.fn();
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "archives",
      onDispose,
      placeholder: "Search archives…",
      snapshot: { options: [{ id: "books", label: "Books" }] },
      title: "Switch archive",
    });
    const command = createCommand("archive.switch", "Switch archive…", {
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const dialog = rendered.container.querySelector<HTMLDialogElement>("dialog")!;
    await act(async () => pressKey(input, "Enter"));

    act(() => {
      dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      dialog.click();
    });

    expect(rendered.onClose).toHaveBeenCalledOnce();
    expect(onDispose).toHaveBeenCalledOnce();
  });

  it("disposes a replaced child mode and transfers ownership to the replacement", async () => {
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    const secondMode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "second",
      onDispose: disposeSecond,
      placeholder: "Search second options…",
      snapshot: { options: [{ id: "second-option", label: "Second option" }] },
      title: "Second mode",
    });
    const firstMode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "child-mode", mode: secondMode }),
      id: "first",
      onDispose: disposeFirst,
      placeholder: "Search first options…",
      snapshot: { options: [{ id: "first-option", label: "First option" }] },
      title: "First mode",
    });
    const command = createCommand("staged", "Open staged mode", {
      runInPalette: () => ({ kind: "child-mode", mode: firstMode }),
    });
    const rendered = await renderPalette([command], () => ({
      kind: "child-mode",
      mode: firstMode,
    }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => pressKey(input, "Enter"));
    await act(async () => pressKey(input, "Enter"));

    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(disposeSecond).not.toHaveBeenCalled();
    expect(input.placeholder).toBe("Search second options…");
    expect(rendered.container.textContent).toContain("Second mode");

    act(() => root?.unmount());
    root = null;
    expect(disposeSecond).toHaveBeenCalledOnce();
  });

  it("ignores a stale confirmation result after child cancellation", async () => {
    let resolveConfirmation!: (outcome: QuickActionPaletteOutcome) => void;
    const confirmation = new Promise<QuickActionPaletteOutcome>((resolve) => {
      resolveConfirmation = resolve;
    });
    const onDispose = vi.fn();
    const mode = new QuickActionChildModeSession({
      confirm: () => confirmation,
      id: "archives",
      onDispose,
      placeholder: "Search archives…",
      snapshot: { options: [{ id: "comics", label: "Comics" }] },
      title: "Switch archive",
    });
    const command = createCommand("archive.switch", "Switch archive…", {
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    await act(async () => pressKey(input, "Enter"));
    act(() => pressKey(input, "Enter"));
    await act(async () => pressKey(input, "Escape"));
    await act(async () => {
      resolveConfirmation({ error: "Stale failure", kind: "keep-open" });
      await confirmation;
    });

    expect(onDispose).toHaveBeenCalledOnce();
    expect(rendered.container.textContent).not.toContain("Stale failure");
    expect(input.placeholder).toBe("Type a command…");
  });

  it("disposes a stale replacement returned after child cancellation", async () => {
    let resolveConfirmation!: (outcome: QuickActionPaletteOutcome) => void;
    const confirmation = new Promise<QuickActionPaletteOutcome>((resolve) => {
      resolveConfirmation = resolve;
    });
    const disposeReplacement = vi.fn();
    const replacement = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "replacement",
      onDispose: disposeReplacement,
      placeholder: "Search replacement…",
      snapshot: { options: [{ id: "replacement-option", label: "Replacement" }] },
      title: "Replacement",
    });
    const mode = new QuickActionChildModeSession({
      confirm: () => confirmation,
      id: "initial",
      placeholder: "Search initial…",
      snapshot: { options: [{ id: "initial-option", label: "Initial" }] },
      title: "Initial",
    });
    const command = createCommand("staged", "Open staged mode", {
      runInPalette: () => ({ kind: "child-mode", mode }),
    });
    const rendered = await renderPalette([command], () => ({ kind: "child-mode", mode }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    act(() => pressKey(input, "Enter"));
    act(() => pressKey(input, "Enter"));
    await act(async () => pressKey(input, "Escape"));
    await act(async () => {
      resolveConfirmation({ kind: "child-mode", mode: replacement });
      await confirmation;
    });

    expect(disposeReplacement).toHaveBeenCalledOnce();
    expect(input.placeholder).toBe("Type a command…");
  });

  it("retires an older asynchronous root mode when a newer root mode takes ownership", async () => {
    let resolveFirst!: (outcome: QuickActionPaletteOutcome) => void;
    const firstOutcome = new Promise<QuickActionPaletteOutcome>((resolve) => {
      resolveFirst = resolve;
    });
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    const firstMode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "first-mode",
      onDispose: disposeFirst,
      placeholder: "Search first…",
      snapshot: { options: [{ id: "first-option", label: "First" }] },
      title: "First mode",
    });
    const secondMode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "second-mode",
      onDispose: disposeSecond,
      placeholder: "Search second…",
      snapshot: { options: [{ id: "second-option", label: "Second" }] },
      title: "Second mode",
    });
    const firstCommand = createCommand("first", "First mode", {
      order: 1,
      runInPalette: () => firstOutcome,
    });
    const secondCommand = createCommand("second", "Second mode", {
      order: 2,
      runInPalette: () => ({ kind: "child-mode", mode: secondMode }),
    });
    const rendered = await renderPalette([firstCommand, secondCommand], (command) =>
      command.id === "first" ? firstOutcome : { kind: "child-mode", mode: secondMode },
    );
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const recordRecent = vi.spyOn(rendered.registry, "recordRecent");

    act(() => pressKey(input, "Enter"));
    act(() => pressKey(input, "ArrowDown"));
    act(() => pressKey(input, "Enter"));
    expect(input.placeholder).toBe("Search second…");

    await act(async () => {
      resolveFirst({ kind: "child-mode", mode: firstMode });
      await firstOutcome;
    });

    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(disposeSecond).not.toHaveBeenCalled();
    expect(recordRecent).toHaveBeenCalledOnce();
    expect(recordRecent).toHaveBeenCalledWith("second");
    expect(input.placeholder).toBe("Search second…");
    expect(rendered.container.textContent).toContain("Second mode");
  });

  it("disposes a late root mode after the palette closes", async () => {
    let resolveOutcome!: (outcome: QuickActionPaletteOutcome) => void;
    const pendingOutcome = new Promise<QuickActionPaletteOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    const onDispose = vi.fn();
    const lateMode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "late",
      onDispose,
      placeholder: "Search late options…",
      snapshot: { options: [] },
      title: "Late mode",
    });
    const command = createCommand("late", "Late mode", { runInPalette: () => pendingOutcome });
    const rendered = await renderPalette([command], () => pendingOutcome);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    act(() => pressKey(input, "Enter"));
    await act(async () => pressKey(input, "Escape"));
    await act(async () => {
      resolveOutcome({ kind: "child-mode", mode: lateMode });
      await pendingOutcome;
    });

    expect(rendered.onClose).toHaveBeenCalledOnce();
    expect(onDispose).toHaveBeenCalledOnce();
  });

  it("disposes a late root mode after the palette unmounts", async () => {
    let resolveOutcome!: (outcome: QuickActionPaletteOutcome) => void;
    const pendingOutcome = new Promise<QuickActionPaletteOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    const onDispose = vi.fn();
    const lateMode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "late-unmount",
      onDispose,
      placeholder: "Search late options…",
      snapshot: { options: [] },
      title: "Late mode",
    });
    const command = createCommand("late", "Late mode", { runInPalette: () => pendingOutcome });
    const rendered = await renderPalette([command], () => pendingOutcome);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    act(() => pressKey(input, "Enter"));
    act(() => root?.unmount());
    root = null;
    await act(async () => {
      resolveOutcome({ kind: "child-mode", mode: lateMode });
      await pendingOutcome;
    });

    expect(onDispose).toHaveBeenCalledOnce();
  });

  it("does not publish stale keep-open feedback from an older root operation", async () => {
    let resolveFirst!: (outcome: QuickActionPaletteOutcome) => void;
    const firstOutcome = new Promise<QuickActionPaletteOutcome>((resolve) => {
      resolveFirst = resolve;
    });
    const secondMode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "second-mode",
      placeholder: "Search second…",
      snapshot: { options: [{ id: "second-option", label: "Second" }] },
      title: "Second mode",
    });
    const firstCommand = createCommand("first", "First mode", {
      order: 1,
      runInPalette: () => firstOutcome,
    });
    const secondCommand = createCommand("second", "Second mode", {
      order: 2,
      runInPalette: () => ({ kind: "child-mode", mode: secondMode }),
    });
    const rendered = await renderPalette([firstCommand, secondCommand], (command) =>
      command.id === "first" ? firstOutcome : { kind: "child-mode", mode: secondMode },
    );
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    act(() => pressKey(input, "Enter"));
    act(() => pressKey(input, "ArrowDown"));
    act(() => pressKey(input, "Enter"));
    await act(async () => {
      resolveFirst({ error: "Stale root failure", kind: "keep-open" });
      await firstOutcome;
    });

    expect(rendered.container.textContent).not.toContain("Stale root failure");
    expect(input.placeholder).toBe("Search second…");
  });
});
