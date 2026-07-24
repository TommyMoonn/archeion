// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { KeyboardBinding, KeyboardPreferences } from "../../types/keyboard";
import { isReaderKeyboardCommandEligible } from "../reader/readerNavigation";
import type { AppCommand, KeyboardInteractionContext } from "./appCommands";
import { resolveKeyboardCommand } from "./commandResolver";

const preferences: KeyboardPreferences = { shortcuts: {} };
const primaryK: KeyboardBinding = { alt: false, key: "k", primary: true, shift: false };

afterEach(() => {
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

function command(
  id: string,
  scope: AppCommand["scope"],
  overrides: Partial<AppCommand> = {},
): AppCommand {
  return {
    configuration: "configurable",
    defaultBinding: primaryK,
    execute: vi.fn(),
    group: "System",
    id,
    label: id,
    scope,
    ...overrides,
  };
}

function keyboardEvent(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: "k",
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function context(
  sourceDocument = document,
  platform: KeyboardInteractionContext["platform"] = "windows-linux",
): KeyboardInteractionContext {
  return { applicationDocument: document, platform, sourceDocument };
}

describe("keyboard command resolver", () => {
  it("selects one command from non-overlapping active scopes", () => {
    const target = document.createElement("button");
    document.body.append(target);
    const library = command("library", "library");
    const reader = command("reader", "reader");

    const resolved = resolveKeyboardCommand(
      keyboardEvent(target),
      [library, reader],
      preferences,
      context(),
    );
    resolved?.command.execute();

    expect(resolved?.command).toBe(reader);
    expect(reader.execute).toHaveBeenCalledTimes(1);
    expect(library.execute).not.toHaveBeenCalled();
  });

  it("throws for overlapping duplicate runtime registrations instead of hiding them by priority", () => {
    const target = document.createElement("button");
    const global = command("global", "global");
    const reader = command("reader", "reader");

    expect(() =>
      resolveKeyboardCommand(keyboardEvent(target), [global, reader], preferences, context()),
    ).toThrow("Conflicting keyboard command registrations");
  });

  it.each([
    ["default prevented", { defaultPrevented: true }],
    ["IME composition", { isComposing: true }],
    ["repeat", { repeat: true }],
  ])("blocks %s events", (_label, flags) => {
    const target = document.createElement("button");
    const event = keyboardEvent(target);
    for (const [name, value] of Object.entries(flags)) {
      Object.defineProperty(event, name, { configurable: true, value });
    }

    expect(
      resolveKeyboardCommand(event, [command("global", "global")], preferences, context()),
    ).toBeNull();
  });

  it("matches the semantic primary modifier on macOS", () => {
    const target = document.createElement("button");
    const candidate = command("global", "global");
    const event = keyboardEvent(target, { ctrlKey: false, metaKey: true });

    expect(
      resolveKeyboardCommand(event, [candidate], preferences, context(document, "mac"))?.command,
    ).toBe(candidate);
    expect(
      resolveKeyboardCommand(event, [candidate], preferences, context(document, "windows-linux")),
    ).toBeNull();
  });

  it("blocks text entry, contenteditable, source selections, and reader-owned transient targets", () => {
    const global = command("global", "global");
    for (const target of [document.createElement("input"), document.createElement("textarea")]) {
      document.body.append(target);
      expect(
        resolveKeyboardCommand(keyboardEvent(target), [global], preferences, context()),
      ).toBeNull();
    }

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);
    expect(
      resolveKeyboardCommand(keyboardEvent(editable), [global], preferences, context()),
    ).toBeNull();

    const epubDocument = document.implementation.createHTMLDocument("EPUB");
    const selected = epubDocument.createElement("p");
    selected.textContent = "selected text";
    epubDocument.body.append(selected);
    vi.spyOn(epubDocument, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
    expect(
      resolveKeyboardCommand(
        keyboardEvent(selected),
        [command("reader", "reader")],
        preferences,
        context(epubDocument),
      ),
    ).toBeNull();

    const transient = document.createElement("div");
    transient.dataset.readerIgnoreShortcuts = "";
    const button = document.createElement("button");
    transient.append(button);
    document.body.append(transient);
    expect(
      resolveKeyboardCommand(
        keyboardEvent(button),
        [command("reader", "reader")],
        preferences,
        context(),
      ),
    ).toBeNull();
  });

  it("blocks every lower command scope while a controlled context menu owns interaction", () => {
    const menu = document.createElement("div");
    menu.dataset.applicationTransient = "context-menu";
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    const target = document.createElement("button");
    document.body.append(target);

    for (const scope of [
      "global",
      "library",
      "folders",
      "reader",
      "settings",
      "transient-surface",
    ] as const) {
      expect(
        resolveKeyboardCommand(
          keyboardEvent(target),
          [command(`command-${scope}`, scope)],
          preferences,
          context(),
        ),
      ).toBeNull();
    }

    const epubDocument = document.implementation.createHTMLDocument("EPUB");
    const epubTarget = epubDocument.createElement("p");
    epubDocument.body.append(epubTarget);
    expect(
      resolveKeyboardCommand(
        keyboardEvent(epubTarget),
        [command("reader-epub", "reader")],
        preferences,
        context(epubDocument),
      ),
    ).toBeNull();
  });

  it("blocks EPUB-originating global and reader commands while a parent transient surface is open", () => {
    const dialog = document.createElement("dialog");
    dialog.className = "settings-dialog";
    dialog.setAttribute("open", "");
    document.body.append(dialog);

    const epubDocument = document.implementation.createHTMLDocument("EPUB");
    const target = epubDocument.createElement("p");
    epubDocument.body.append(target);
    const event = keyboardEvent(target);

    expect(
      resolveKeyboardCommand(
        event,
        [command("global", "global"), command("reader", "reader")],
        preferences,
        context(epubDocument),
      ),
    ).toBeNull();
  });

  it("allows the active parent Settings scope to own an EPUB-originating event", () => {
    const dialog = document.createElement("dialog");
    dialog.className = "settings-dialog";
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const epubDocument = document.implementation.createHTMLDocument("EPUB");
    const target = epubDocument.createElement("p");
    epubDocument.body.append(target);
    const settings = command("settings", "settings");

    expect(
      resolveKeyboardCommand(keyboardEvent(target), [settings], preferences, context(epubDocument))
        ?.command,
    ).toBe(settings);
  });

  it("normalizes browser Space for fixed reader navigation", () => {
    const target = document.createElement("p");
    const readerCommand = command("reader.next-page-space", "reader", {
      configuration: "fixed",
      defaultBinding: { alt: false, key: "space", primary: false, shift: false },
    });

    expect(
      resolveKeyboardCommand(
        keyboardEvent(target, { ctrlKey: false, key: " " }),
        [readerCommand],
        preferences,
        context(),
      )?.command,
    ).toBe(readerCommand);
  });

  it("uses the same configured resolution for parent and EPUB documents", () => {
    const configured: KeyboardPreferences = {
      shortcuts: { "shared.command": { binding: { ...primaryK, key: "j" } } },
    };
    const shared = command("shared.command", "reader");
    const parentTarget = document.createElement("p");
    const epubDocument = document.implementation.createHTMLDocument("EPUB");
    const epubTarget = epubDocument.createElement("p");

    expect(
      resolveKeyboardCommand(
        keyboardEvent(parentTarget, { key: "j" }),
        [shared],
        configured,
        context(),
      )?.command.id,
    ).toBe("shared.command");
    expect(
      resolveKeyboardCommand(
        keyboardEvent(epubTarget, { key: "j" }),
        [shared],
        configured,
        context(epubDocument),
      )?.command.id,
    ).toBe("shared.command");
  });

  it("retains publisher-control protection without rematching command identities", () => {
    const epubDocument = document.implementation.createHTMLDocument("EPUB");
    const link = epubDocument.createElement("a");
    link.href = "chapter.xhtml";
    epubDocument.body.append(link);
    const readerCommand = command("reader", "reader", {
      canHandleEvent: isReaderKeyboardCommandEligible,
      defaultBinding: { alt: false, key: "arrowright", primary: false, shift: false },
    });

    expect(
      resolveKeyboardCommand(
        keyboardEvent(link, { ctrlKey: false, key: "ArrowRight" }),
        [readerCommand],
        preferences,
        context(epubDocument),
      ),
    ).toBeNull();
  });
});
