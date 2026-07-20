// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { KeyboardBinding } from "../../types/keyboard";
import {
  ariaKeyShortcut,
  commandDefinitions,
  commandScopesOverlap,
  configurableCommandDefinitions,
  findKeyboardPreferenceConflicts,
  formatKeyboardBinding,
  keyboardBindingFromEvent,
  normalizeKeyboardPreferences,
  validateKeyboardBinding,
} from "./commandBindings";

const primary = (key: string, shift = false): KeyboardBinding => ({
  alt: false,
  key,
  primary: true,
  shift,
});

describe("central keyboard command model", () => {
  it("defines the seven planned configurable commands from one authoritative model", () => {
    expect(configurableCommandDefinitions.map((command) => command.id)).toEqual([
      "system.quick-actions",
      "system.open-settings",
      "surface.focus-search",
      "reader.open-toc",
      "reader.open-annotations",
      "reader.toggle-bookmark",
      "reader.open-reading-settings",
    ]);
    expect(commandDefinitions.quickActions.defaultBinding).toEqual(primary("p", true));
    expect(commandDefinitions.readerSettings.defaultBinding).toEqual({
      alt: false,
      key: "s",
      primary: false,
      shift: false,
    });
    expect("defaultBinding" in commandDefinitions.settings).toBe(false);
    expect("defaultBinding" in commandDefinitions.focusSearch).toBe(false);
  });

  it("matches and presents the semantic platform-primary modifier", () => {
    const binding = primary("k", true);
    expect(formatKeyboardBinding(binding, "windows-linux")).toBe("Ctrl+Shift+K");
    expect(formatKeyboardBinding(binding, "mac")).toBe("Command+Shift+K");
    expect(ariaKeyShortcut(binding, "windows-linux")).toBe("Control+Shift+K");
    expect(ariaKeyShortcut(binding, "mac")).toBe("Meta+Shift+K");
    expect(
      keyboardBindingFromEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toEqual(binding);
  });

  it("uses one overlap implementation for validation and assertions", () => {
    expect(commandScopesOverlap(["global"], ["reader"])).toBe(true);
    expect(commandScopesOverlap(["library"], ["reader"])).toBe(false);

    const preferences = {
      shortcuts: {
        [commandDefinitions.quickActions.id]: { binding: primary("k") },
        [commandDefinitions.settings.id]: { binding: primary("k") },
      },
    };
    const conflicts = findKeyboardPreferenceConflicts(preferences);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.commandIds).toEqual([
      commandDefinitions.quickActions.id,
      commandDefinitions.settings.id,
    ]);
    expect(
      validateKeyboardBinding(commandDefinitions.quickActions.id, primary("k"), preferences),
    ).toMatchObject({ ok: false });
  });

  it("rejects conflicting normalized preferences instead of relying on priority", () => {
    expect(() =>
      normalizeKeyboardPreferences({
        shortcuts: {
          [commandDefinitions.quickActions.id]: { binding: primary("k") },
          [commandDefinitions.settings.id]: { binding: primary("k") },
        },
      }),
    ).toThrow(
      /Ctrl\+K.*(system\.quick-actions.*system\.open-settings|system\.open-settings.*system\.quick-actions)/,
    );
  });

  it("rejects reserved fixed and Alt-owned combinations", () => {
    expect(
      validateKeyboardBinding(commandDefinitions.quickActions.id, primary("l"), {
        shortcuts: {},
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateKeyboardBinding(
        commandDefinitions.quickActions.id,
        { alt: true, key: "k", primary: true, shift: false },
        { shortcuts: {} },
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateKeyboardBinding(
        commandDefinitions.readerToc.id,
        { alt: false, key: "escape", primary: false, shift: false },
        { shortcuts: {} },
      ),
    ).toMatchObject({ ok: false });
  });
});
