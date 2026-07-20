// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../types/appSettings";
import type { KeyboardPreferences } from "../../types/keyboard";
import { commandDefinitions } from "../quick-actions/commandBindings";
import { keyboardSettingsItems } from "./settingsItems/keyboardSettingsItems";
import { KeyboardShortcutRow, ResetKeyboardShortcutsRow } from "./KeyboardShortcutSettings";
import { KeyboardSettingsSection } from "./sections/KeyboardSettingsSection";
import type { SettingsDialogController } from "./useSettingsDialogController";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  root = null;
  container = null;
});

function controller(
  keyboard: KeyboardPreferences = defaultAppPreferences.keyboard,
  updateAppPreferences = vi.fn(async () => true),
): SettingsDialogController {
  const preferences = { ...defaultAppPreferences, keyboard };
  return {
    preferences,
    keyboard,
    persistenceStatus: { status: "idle" },
    status: null,
    updateAppPreferences,
  } as unknown as SettingsDialogController;
}

function render(element: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

function buttonByName(name: string): HTMLButtonElement {
  const match = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!match) throw new Error(`Button not found: ${name}`);
  return match;
}

function textButton(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

function openCapture(commandLabel: string): HTMLButtonElement {
  const trigger = buttonByName(`Change shortcut for ${commandLabel}`);
  trigger.focus();
  act(() => trigger.click());
  return trigger;
}

describe("Keyboard settings", () => {
  it("renders the Keyboard heading without the removed section description", () => {
    const markup = renderToStaticMarkup(<KeyboardSettingsSection context={controller()} />);

    expect(markup).toContain("<h2>Keyboard</h2>");
    expect(markup).not.toContain(
      "Configure application shortcuts and review fixed reader interaction keys.",
    );
    expect(markup).not.toMatch(/<header>\s*<h2>Keyboard<\/h2>\s*<p/);
  });

  it("renders the compact grouped keymap without implementation metadata", () => {
    const markup = renderToStaticMarkup(<KeyboardSettingsSection context={controller()} />);

    for (const group of [
      "General",
      "Library and Folders",
      "Reader",
      "Fixed Interaction Keys",
      "Reset shortcuts",
    ]) {
      expect(markup).toContain(`>${group}<`);
    }
    for (const command of [
      "Open Quick Actions",
      "Open Settings",
      "Focus search",
      "Toggle table of contents",
      "Toggle annotations",
      "Toggle bookmark",
      "Toggle reader settings",
    ]) {
      expect(markup).toContain(command);
    }
    expect(markup).toContain("Ctrl+Shift+P");
    expect(markup).toContain("Context menu");
    expect(markup).not.toMatch(/Current:|Default:|Scope:|Read only/);
    expect(markup).not.toContain(">Change<");
    expect(markup).not.toContain(">Clear<");
  });

  it("keeps reset-all as the final Keyboard item after fixed interactions", () => {
    expect(keyboardSettingsItems.at(-1)?.id).toBe("keyboard.reset-all");
    expect(keyboardSettingsItems.at(-1)?.groupLabel).toBe("Reset shortcuts");
    const fixedInteractionIndex = keyboardSettingsItems.reduce(
      (lastIndex, item, index) =>
        item.groupLabel === "Fixed Interaction Keys" ? index : lastIndex,
      -1,
    );
    expect(
      keyboardSettingsItems.findIndex((item) => item.id === "keyboard.reset-all"),
    ).toBeGreaterThan(fixedInteractionIndex);
    expect(
      keyboardSettingsItems.some(
        (item) => item.id === "keyboard.reset-all" && item.groupLabel === "General",
      ),
    ).toBe(false);
  });

  it("opens capture from the binding and uses the shared Dialog contract", () => {
    render(
      <KeyboardShortcutRow command={commandDefinitions.quickActions} context={controller()} />,
    );

    openCapture(commandDefinitions.quickActions.label);
    const dialog = document.querySelector<HTMLDialogElement>(".keyboard-shortcut-capture-dialog");

    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains("dialog")).toBe(true);
    expect(dialog?.querySelector(".dialog__panel")).not.toBeNull();
    expect(dialog?.textContent).toContain("Change Open Quick Actions");
    expect(dialog?.textContent).toContain("Escape cancels");
  });

  it("keeps footer controls keyboard-operable outside the chord capture target", () => {
    render(
      <KeyboardShortcutRow command={commandDefinitions.quickActions} context={controller()} />,
    );

    openCapture(commandDefinitions.quickActions.label);
    const cancel = textButton("Cancel");
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    cancel.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.body.textContent).toContain("Press a shortcut");
  });

  it("reports conflicts immediately and saves one valid chord", async () => {
    const updateAppPreferences = vi.fn(async () => true);
    render(
      <KeyboardShortcutRow
        command={commandDefinitions.quickActions}
        context={controller(defaultAppPreferences.keyboard, updateAppPreferences)}
      />,
    );

    openCapture(commandDefinitions.quickActions.label);
    const capture = document.querySelector<HTMLElement>(".keyboard-shortcut-capture")!;

    act(() => {
      capture.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: ",",
        }),
      );
    });
    const conflict = document.querySelector('[role="alert"]')?.textContent ?? "";
    expect(conflict).toContain("Ctrl+,");
    expect(conflict).toContain(commandDefinitions.quickActions.id);
    expect(conflict).toContain(commandDefinitions.settings.id);
    expect(textButton("Save shortcut").disabled).toBe(true);

    act(() => {
      capture.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "K",
          shiftKey: true,
        }),
      );
    });
    expect(document.body.textContent).toContain("Ctrl+Shift+K");

    await act(async () => textButton("Save shortcut").click());
    expect(updateAppPreferences).toHaveBeenCalledWith(
      {
        keyboard: {
          shortcuts: {
            [commandDefinitions.quickActions.id]: {
              binding: { alt: false, key: "k", primary: true, shift: true },
            },
          },
        },
      },
      { successMessage: "Open Quick Actions shortcut updated." },
    );
    expect(document.querySelector(".keyboard-shortcut-capture-dialog")).toBeNull();
  });

  it("Escape cancels capture only and restores focus without changing the binding", () => {
    const updateAppPreferences = vi.fn(async () => true);
    render(
      <KeyboardShortcutRow
        command={commandDefinitions.settings}
        context={controller(defaultAppPreferences.keyboard, updateAppPreferences)}
      />,
    );

    const trigger = openCapture(commandDefinitions.settings.label);
    const capture = document.querySelector<HTMLElement>(".keyboard-shortcut-capture")!;
    expect(textButton("Cancel")).toBeTruthy();

    act(() => {
      capture.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });

    expect(document.querySelector(".keyboard-shortcut-capture-dialog")).toBeNull();
    expect(updateAppPreferences).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("clears through the accessible X without opening capture and shows Unassigned", async () => {
    const updateAppPreferences = vi.fn(async () => true);
    render(
      <KeyboardShortcutRow
        command={commandDefinitions.settings}
        context={controller(defaultAppPreferences.keyboard, updateAppPreferences)}
      />,
    );

    const clear = buttonByName("Clear shortcut for Open Settings");
    clear.focus();
    expect(document.activeElement).toBe(clear);
    expect(clear.tabIndex).toBeGreaterThanOrEqual(0);
    await act(async () => clear.click());

    expect(document.querySelector(".keyboard-shortcut-capture-dialog")).toBeNull();
    expect(updateAppPreferences).toHaveBeenCalledWith(
      {
        keyboard: {
          shortcuts: {
            [commandDefinitions.settings.id]: { disabled: true },
          },
        },
      },
      { successMessage: "Open Settings shortcut cleared." },
    );

    act(() => {
      root?.render(
        <KeyboardShortcutRow
          command={commandDefinitions.settings}
          context={controller(
            { shortcuts: { [commandDefinitions.settings.id]: { disabled: true } } },
            updateAppPreferences,
          )}
        />,
      );
    });
    expect(buttonByName("Change shortcut for Open Settings").textContent).toContain("Unassigned");
    expect(document.querySelector('[aria-label="Clear shortcut for Open Settings"]')).toBeNull();
  });

  it("renders assigned binding and clear actions as separate controls in one compact group", () => {
    render(
      <KeyboardShortcutRow
        command={commandDefinitions.readerToc}
        context={controller(defaultAppPreferences.keyboard)}
      />,
    );

    const group = document.querySelector<HTMLElement>(".keyboard-shortcut-binding-control");
    const binding = buttonByName("Change shortcut for Toggle table of contents");
    const clear = buttonByName("Clear shortcut for Toggle table of contents");

    expect(group).toBeTruthy();
    expect(group?.children).toHaveLength(2);
    expect(group?.children[0]).toBe(binding);
    expect(group?.children[1]).toBe(clear);
    expect(binding.contains(clear)).toBe(false);
    expect(binding.textContent).toContain("T");
  });

  it("omits reset when a redundant persisted override equals the default", () => {
    render(
      <KeyboardShortcutRow
        command={commandDefinitions.settings}
        context={controller({
          shortcuts: {
            [commandDefinitions.settings.id]: {
              binding: { alt: false, key: ",", primary: true, shift: false },
            },
          },
        })}
      />,
    );

    expect(document.querySelector('[aria-label="Reset Open Settings to default"]')).toBeNull();
  });

  it("shows reset only for overrides and reset restores the default", async () => {
    const updateAppPreferences = vi.fn(async () => true);
    const override: KeyboardPreferences = {
      shortcuts: {
        [commandDefinitions.settings.id]: {
          binding: { alt: false, key: "k", primary: true, shift: true },
        },
      },
    };
    render(
      <KeyboardShortcutRow
        command={commandDefinitions.settings}
        context={controller(override, updateAppPreferences)}
      />,
    );

    const reset = buttonByName("Reset Open Settings to default");
    await act(async () => reset.click());
    expect(updateAppPreferences).toHaveBeenCalledWith(
      { keyboard: { shortcuts: {} } },
      { successMessage: "Open Settings shortcut reset." },
    );

    act(() => {
      root?.render(
        <KeyboardShortcutRow
          command={commandDefinitions.settings}
          context={controller(defaultAppPreferences.keyboard, updateAppPreferences)}
        />,
      );
    });
    expect(document.querySelector('[aria-label="Reset Open Settings to default"]')).toBeNull();
    expect(buttonByName("Change shortcut for Open Settings").textContent).toContain("Ctrl+,");
  });

  it("disables reset-all without overrides and restores every default when enabled", async () => {
    const updateAppPreferences = vi.fn(async () => true);
    render(<ResetKeyboardShortcutsRow context={controller()} />);
    expect(textButton("Reset all").disabled).toBe(true);

    act(() => {
      root?.render(
        <ResetKeyboardShortcutsRow
          context={controller(
            {
              shortcuts: {
                [commandDefinitions.quickActions.id]: { disabled: true },
                [commandDefinitions.readerToc.id]: {
                  binding: { alt: false, key: "q", primary: false, shift: false },
                },
              },
            },
            updateAppPreferences,
          )}
        />,
      );
    });
    expect(textButton("Reset all").disabled).toBe(false);
    await act(async () => textButton("Reset all").click());
    expect(updateAppPreferences).toHaveBeenCalledWith(
      { keyboard: { shortcuts: {} } },
      { successMessage: "Keyboard shortcuts reset." },
    );
  });

  it("keeps capture content shrinkable and does not override shared dialog geometry", () => {
    const css = readFileSync(resolve("src/styles/features/settings.css"), "utf8");
    expect(css).not.toMatch(/\.keyboard-shortcut-capture-dialog\s+\.dialog__panel/);
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("min-width: 0");
  });

  it("uses content-sized bindings and a permanently visible non-overlapping clear control", () => {
    const css = readFileSync(resolve("src/styles/features/settings.css"), "utf8");
    const bindingRule = css.match(/\.keyboard-shortcut-binding\s*\{(?<body>[^}]*)\}/)?.groups?.body;
    const bindingControlRule = css.match(/\.keyboard-shortcut-binding-control\s*\{(?<body>[^}]*)\}/)
      ?.groups?.body;
    const clearRule = css.match(/\.keyboard-shortcut-clear\s*\{(?<body>[^}]*)\}/)?.groups?.body;

    expect(css).not.toContain("min-width: 112px");
    expect(bindingRule).toContain("flex: 0 1 auto");
    expect(bindingRule).toContain("max-width: 100%");
    expect(bindingRule).not.toMatch(/(?:^|;)\s*width\s*:/);
    expect(bindingControlRule).toContain("display: inline-flex");
    expect(bindingControlRule).not.toContain("position: relative");
    expect(clearRule).not.toContain("position: absolute");
    expect(clearRule).not.toContain("opacity:");
    expect(css).not.toMatch(/keyboard-shortcut-binding-control:(?:hover|focus-within)[^{]*\{/);
  });
});
