// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../types/appSettings";
import type { KeyboardPreferences } from "../../types/keyboard";
import { commandDefinitions } from "../commands/commandBindings";
import { KeyboardShortcutRow, ResetKeyboardShortcutsRow } from "./KeyboardShortcutSettings";
import type { SettingsController } from "./useSettingsController";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function updateAppPreferencesMock() {
  return vi.fn<SettingsController["updateAppPreferences"]>(async () => true);
}

beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
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
  updateAppPreferences: SettingsController["updateAppPreferences"] = updateAppPreferencesMock(),
): SettingsController {
  const preferences = { ...defaultAppPreferences, keyboard };
  return {
    preferences,
    keyboard,
    persistenceStatus: { status: "idle" },
    status: null,
    updateAppPreferences,
  } as unknown as SettingsController;
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

function captureTarget(): HTMLElement {
  const match = document.querySelector<HTMLElement>(
    '[role="group"][aria-label="Shortcut capture"]',
  );
  if (!match) throw new Error("Shortcut capture target was not rendered");
  return match;
}

describe("Keyboard settings", () => {
  it("reports conflicts immediately and saves one valid chord", async () => {
    const updateAppPreferences = updateAppPreferencesMock();
    render(
      <KeyboardShortcutRow
        command={commandDefinitions.quickActions}
        context={controller(defaultAppPreferences.keyboard, updateAppPreferences)}
      />,
    );

    openCapture(commandDefinitions.quickActions.label);
    const capture = captureTarget();

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
    const conflict = document.querySelector('[role="alert"]');
    expect(conflict?.getAttribute("data-tone")).toBe("error");
    expect(capture.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(capture.getAttribute("aria-describedby")!)).toBe(conflict);
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
    expect(capture.getAttribute("aria-invalid")).toBeNull();
    expect(
      document.getElementById(capture.getAttribute("aria-describedby")!)?.getAttribute("role"),
    ).toBe("status");

    await act(async () => textButton("Save shortcut").click());
    expect(updateAppPreferences.mock.calls[0]?.[0]).toEqual({
      keyboard: {
        shortcuts: {
          [commandDefinitions.quickActions.id]: {
            binding: { alt: false, key: "k", primary: true, shift: true },
          },
        },
      },
    });
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("keeps a valid candidate available to retry after a failed save", async () => {
    const updateAppPreferences = updateAppPreferencesMock().mockResolvedValueOnce(false);
    render(
      <KeyboardShortcutRow
        command={commandDefinitions.quickActions}
        context={controller(defaultAppPreferences.keyboard, updateAppPreferences)}
      />,
    );
    openCapture(commandDefinitions.quickActions.label);
    act(() =>
      captureTarget().dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          shiftKey: true,
          key: "K",
        }),
      ),
    );
    await act(async () => textButton("Save shortcut").click());
    expect(document.querySelector<HTMLDialogElement>("dialog")?.open).toBe(true);
    expect(textButton("Save shortcut").disabled).toBe(false);
    expect(captureTarget().textContent).toContain("Ctrl+Shift+K");
    await act(async () => textButton("Save shortcut").click());
    expect(updateAppPreferences).toHaveBeenCalledTimes(2);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("clears without opening capture and shows the unassigned state", async () => {
    const updateAppPreferences = updateAppPreferencesMock();
    render(
      <KeyboardShortcutRow
        command={commandDefinitions.settings}
        context={controller(defaultAppPreferences.keyboard, updateAppPreferences)}
      />,
    );

    const clear = buttonByName("Clear shortcut for Open Settings");
    await act(async () => clear.click());

    expect(document.querySelector("dialog")).toBeNull();
    expect(updateAppPreferences.mock.calls[0]?.[0]).toEqual({
      keyboard: {
        shortcuts: {
          [commandDefinitions.settings.id]: { disabled: true },
        },
      },
    });

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
    const updateAppPreferences = updateAppPreferencesMock();
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
    expect(updateAppPreferences.mock.calls[0]?.[0]).toEqual({ keyboard: { shortcuts: {} } });

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
    const updateAppPreferences = updateAppPreferencesMock();
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
    expect(updateAppPreferences.mock.calls[0]?.[0]).toEqual({ keyboard: { shortcuts: {} } });
  });
});
