// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../../types/appSettings";
import { commandDefinitions } from "../../commands/commandBindings";
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
    container.querySelectorAll<HTMLElement>("[data-settings-group][role=group]"),
    (group) => group.getAttribute("aria-label"),
  );
}

describe("KeyboardSettingsSection", () => {
  it("filters configurable shortcuts and fixed key documentation without empty groups", () => {
    const context = controller();
    act(() => root.render(<KeyboardSettingsSection context={context} />));

    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).not.toBeNull();
    expect(search?.closest("label")?.textContent).toContain("Search shortcuts");
    expect(
      container.querySelector('[aria-label="Change shortcut for Open Settings"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="Context menu keys"]')).not.toBeNull();

    changeSearch("book navigation");
    expect(groupLabels()).toEqual(["Reader"]);
    expect(
      container.querySelector('[aria-label="Change shortcut for Toggle book navigation"]'),
    ).not.toBeNull();

    changeSearch("context menu");
    expect(groupLabels()).toEqual(["Fixed Interaction Keys"]);
    expect(container.querySelector('[aria-label="Context menu keys"]')).not.toBeNull();

    changeSearch("no matching shortcut");
    expect(groupLabels()).toEqual([]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "No shortcuts match this search.",
    );
  });

  it("clearing search restores configurable and fixed rows without changing shortcut preferences", () => {
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
    expect(
      container.querySelector('[aria-label="Change shortcut for Open Settings"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="Context menu keys"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Change shortcut for Open Settings"]')?.textContent,
    ).toContain("Ctrl+Shift+K");
    expect(updateAppPreferences).not.toHaveBeenCalled();
  });
});
