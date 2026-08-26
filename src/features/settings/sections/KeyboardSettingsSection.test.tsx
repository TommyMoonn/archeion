// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../../types/appSettings";
import { commandDefinitions } from "../../commands/commandBindings";
import { keyboardSettingsItems } from "../settingsItems/keyboardSettingsItems";
import type { SettingsController } from "../useSettingsController";
import { KeyboardSettingsSection } from "./KeyboardSettingsSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function controller(shortcuts = defaultAppPreferences.keyboard.shortcuts): SettingsController {
  const preferences = {
    ...defaultAppPreferences,
    keyboard: { shortcuts },
  };
  return {
    keyboard: preferences.keyboard,
    persistenceStatus: { status: "idle" },
    preferences,
    status: null,
    updateAppPreferences: vi.fn().mockResolvedValue(true),
  } as unknown as SettingsController;
}

function changeSearch(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

function groupLabels() {
  return Array.from(
    container.querySelectorAll<HTMLElement>(".settings-section__group > h3"),
    (heading) => heading.textContent,
  );
}

describe("KeyboardSettingsSection", () => {
  it("filters configurable shortcuts and fixed key documentation without empty groups", () => {
    const context = controller();
    act(() => root.render(<KeyboardSettingsSection context={context} />));

    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).not.toBeNull();
    expect(search?.closest("label")?.textContent).toContain("Search shortcuts");
    expect(container.querySelectorAll("[data-setting-id]")).toHaveLength(
      keyboardSettingsItems.length,
    );

    changeSearch("book navigation");
    expect(groupLabels()).toEqual(["Reader"]);
    expect(container.querySelector('[data-setting-id="keyboard.reader.open-toc"]')).not.toBeNull();

    changeSearch("context menu");
    expect(groupLabels()).toEqual(["Fixed Interaction Keys"]);
    expect(
      container.querySelector('[data-setting-id="keyboard.documentation.fixed-context-menu"]'),
    ).not.toBeNull();

    changeSearch("no matching shortcut");
    expect(container.querySelectorAll("[data-setting-id]")).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "No shortcuts match this search.",
    );
  });

  it("clearing search restores every row without changing shortcut preferences", () => {
    const updateAppPreferences = vi.fn().mockResolvedValue(true);
    const context = controller({
      [commandDefinitions.settings.id]: {
        binding: { alt: false, key: "k", primary: true, shift: true },
      },
    });
    context.updateAppPreferences = updateAppPreferences;
    act(() => root.render(<KeyboardSettingsSection context={context} />));

    changeSearch("context menu");
    const input = changeSearch("");

    expect(input.value).toBe("");
    expect(container.querySelectorAll("[data-setting-id]")).toHaveLength(
      keyboardSettingsItems.length,
    );
    expect(
      container.querySelector('[aria-label="Change shortcut for Open Settings"]')?.textContent,
    ).toContain("Ctrl+Shift+K");
    expect(updateAppPreferences).not.toHaveBeenCalled();
  });
});
