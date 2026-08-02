// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { KeyboardBinding } from "../../types/keyboard";
import {
  ariaKeyShortcut,
  commandDefinitions,
  commandScopesOverlap,
  configurableCommandDefinitions,
  defaultKeyboardPreferences,
  effectiveKeyboardBinding,
  findKeyboardPreferenceConflicts,
  formatKeyboardBinding,
  keyboardBindingFromEvent,
  keyboardEventOwnershipError,
  normalizeKeyboardPreferences,
  setKeyboardShortcutOverride,
  validateKeyboardBinding,
} from "./commandBindings";

const primary = (key: string, shift = false): KeyboardBinding => ({
  alt: false,
  key,
  primary: true,
  shift,
});

const plain = (key: string): KeyboardBinding => ({
  alt: false,
  key,
  primary: false,
  shift: false,
});

describe("keyboard command bindings", () => {
  it("defines all eight configurable commands from one authoritative model", () => {
    expect(configurableCommandDefinitions.map((definition) => definition.id)).toEqual([
      "system.quick-actions",
      "system.open-settings",
      "surface.focus-search",
      "library.toggle-sidebar",
      "reader.open-toc",
      "reader.open-annotations",
      "reader.toggle-bookmark",
      "reader.open-reading-settings",
    ]);
    expect(configurableCommandDefinitions.map((definition) => definition.defaultBinding)).toEqual([
      primary("p", true),
      primary(","),
      primary("f"),
      primary("b"),
      plain("t"),
      plain("a"),
      plain("b"),
      plain("s"),
    ]);
    expect(commandDefinitions.focusSearch.showInPalette).toBe(false);
    expect(commandDefinitions.toggleSidebar).toMatchObject({
      configuration: "configurable",
      group: "Library and Folders",
      scopes: ["library", "folders"],
      visibleControlOwner: "Main titlebar",
    });
  });

  it("uses the platform primary modifier for matching, display, and ARIA", () => {
    const binding = effectiveKeyboardBinding(commandDefinitions.quickActions, { shortcuts: {} });

    expect(formatKeyboardBinding(binding, "windows-linux")).toBe("Ctrl+Shift+P");
    expect(ariaKeyShortcut(binding, "windows-linux")).toBe("Control+Shift+P");
    expect(formatKeyboardBinding(binding, "mac")).toBe("Command+Shift+P");
    expect(ariaKeyShortcut(binding, "mac")).toBe("Meta+Shift+P");

    expect(
      keyboardBindingFromEvent(
        new KeyboardEvent("keydown", { key: "p", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toEqual(primary("p", true));
    expect(
      keyboardBindingFromEvent(
        new KeyboardEvent("keydown", { ctrlKey: true, key: "p", shiftKey: true }),
        "windows-linux",
      ),
    ).toEqual(primary("p", true));
  });

  it("rejects unsupported physical modifier ownership", () => {
    expect(
      keyboardEventOwnershipError(
        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
        "windows-linux",
      ),
    ).toContain("Windows or Meta");
    expect(
      keyboardEventOwnershipError(new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }), "mac"),
    ).toContain("Command instead of Control");
  });

  it("migrates legacy Ctrl or Meta bindings to the semantic primary modifier", () => {
    expect(
      normalizeKeyboardPreferences({
        shortcuts: {
          "system.quick-actions": {
            binding: { alt: false, ctrl: true, key: "k", meta: false, shift: true },
          },
          "system.open-settings": {
            binding: { alt: false, ctrl: false, key: "o", meta: true, shift: true },
          },
        },
      }),
    ).toEqual({
      shortcuts: {
        "system.quick-actions": { binding: primary("k", true) },
        "system.open-settings": { binding: primary("o", true) },
      },
    });
  });

  it("uses legacy primary modifiers only when the explicit primary field is absent", () => {
    expect(
      normalizeKeyboardPreferences({
        shortcuts: {
          "system.quick-actions": {
            binding: { ctrl: true, key: "k", primary: "invalid" },
          },
          "system.open-settings": {
            binding: { key: "o", meta: true, primary: null },
          },
          "reader.open-toc": {
            binding: { ctrl: true, key: "7", primary: false },
          },
          "reader.open-annotations": {
            binding: { ctrl: true, key: "q" },
          },
        },
      }),
    ).toEqual({
      shortcuts: {
        "reader.open-toc": { binding: plain("7") },
        "reader.open-annotations": { binding: primary("q") },
      },
    });
  });

  it("canonicalizes a stored default binding back to no override", () => {
    expect(
      normalizeKeyboardPreferences({
        shortcuts: {
          [commandDefinitions.settings.id]: {
            binding: { alt: false, key: ",", primary: true, shift: false },
          },
        },
      }),
    ).toEqual(defaultKeyboardPreferences);
  });

  it("keeps explicit disabled state and drops unknown persisted ids", () => {
    expect(
      normalizeKeyboardPreferences({
        shortcuts: {
          "system.quick-actions": { disabled: true },
          "system.open-settings": { binding: primary("k", true) },
          "removed.command": { binding: primary("u") },
        },
      }),
    ).toEqual({
      shortcuts: {
        "system.quick-actions": { disabled: true },
        "system.open-settings": { binding: primary("k", true) },
      },
    });
  });

  it("keeps the first valid persisted override in authoritative command order", () => {
    expect(
      normalizeKeyboardPreferences({
        shortcuts: {
          "system.open-settings": { binding: primary("k") },
          "system.quick-actions": { binding: primary("k") },
        },
      }),
    ).toEqual({
      shortcuts: {
        "system.quick-actions": { binding: primary("k") },
      },
    });
  });

  it("allows an earlier command to use the default binding of a later disabled command", () => {
    expect(
      normalizeKeyboardPreferences({
        shortcuts: {
          "system.quick-actions": { binding: primary("f") },
          "surface.focus-search": { disabled: true },
        },
      }),
    ).toEqual({
      shortcuts: {
        "system.quick-actions": { binding: primary("f") },
        "surface.focus-search": { disabled: true },
      },
    });
  });

  it("allows an earlier command to use a later command's freed default binding", () => {
    expect(
      normalizeKeyboardPreferences({
        shortcuts: {
          "surface.focus-search": { binding: primary("g") },
          "system.quick-actions": { binding: primary("f") },
        },
      }),
    ).toEqual({
      shortcuts: {
        "system.quick-actions": { binding: primary("f") },
        "surface.focus-search": { binding: primary("g") },
      },
    });
  });

  it("uses the shared scope-overlap implementation for conflict detection", () => {
    expect(commandScopesOverlap(["global"], ["reader"])).toBe(true);
    expect(commandScopesOverlap(["reader"], ["reader"])).toBe(true);
    expect(commandScopesOverlap(["library"], ["reader"])).toBe(false);

    const preferences = {
      shortcuts: {
        [commandDefinitions.readerToc.id]: { binding: plain("a") },
      },
    };
    expect(findKeyboardPreferenceConflicts(preferences)).toEqual([
      {
        binding: plain("a"),
        commandIds: [commandDefinitions.readerToc.id, commandDefinitions.readerAnnotations.id],
      },
    ]);
  });

  it.each([
    [
      "overlapping conflict",
      commandDefinitions.quickActions.id,
      primary(","),
      "system.quick-actions",
    ],
    ["browser reserved", commandDefinitions.quickActions.id, primary("l"), "reserved"],
    ["editing reserved", commandDefinitions.quickActions.id, primary("z"), "text editing"],
    ["Alt combination", commandDefinitions.quickActions.id, { ...primary("k"), alt: true }, "Alt"],
    ["fixed key", commandDefinitions.quickActions.id, primary("escape"), "fixed interaction key"],
    ["unmodified global", commandDefinitions.quickActions.id, plain("k"), "primary modifier"],
  ] as const)("rejects %s bindings", (_case, commandId, candidate, reason) => {
    const validation = validateKeyboardBinding(commandId, candidate, { shortcuts: {} });

    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.reason).toContain(reason);
  });

  it("supports clear and reset without persisting default copies", () => {
    const cleared = setKeyboardShortcutOverride({ shortcuts: {} }, commandDefinitions.settings.id, {
      disabled: true,
    });
    expect(effectiveKeyboardBinding(commandDefinitions.settings, cleared)).toBeUndefined();

    const reset = setKeyboardShortcutOverride(cleared, commandDefinitions.settings.id, undefined);
    expect(effectiveKeyboardBinding(commandDefinitions.settings, reset)).toEqual(primary(","));
    expect(reset).toEqual({ shortcuts: {} });
  });

  it("normalizes a customized or cleared sidebar shortcut for persistence", () => {
    const customized = setKeyboardShortcutOverride(
      defaultKeyboardPreferences,
      commandDefinitions.toggleSidebar.id,
      { binding: primary("g", true) },
    );

    expect(normalizeKeyboardPreferences(customized)).toEqual(customized);
    expect(effectiveKeyboardBinding(commandDefinitions.toggleSidebar, customized)).toEqual(
      primary("g", true),
    );

    const cleared = setKeyboardShortcutOverride(customized, commandDefinitions.toggleSidebar.id, {
      disabled: true,
    });
    expect(normalizeKeyboardPreferences(cleared)).toEqual(cleared);
    expect(effectiveKeyboardBinding(commandDefinitions.toggleSidebar, cleared)).toBeUndefined();
  });
});
