// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  createQuickActionIndex,
  isQuickActionsShortcut,
  isTextEntryTarget,
  QuickActionsRegistry,
  searchQuickActions,
  type QuickActionCommand,
} from "./quickActions";

function command(
  overrides: Partial<QuickActionCommand> & Pick<QuickActionCommand, "id" | "label">,
) {
  return {
    execute: vi.fn(),
    group: "Library" as const,
    ...overrides,
  };
}

describe("QuickActionsRegistry", () => {
  it("replaces registrations by source without stale cleanup removing the new commands", () => {
    const registry = new QuickActionsRegistry();
    const stopFirst = registry.register("surface", [command({ id: "first", label: "First" })]);
    registry.register("surface", [command({ id: "second", label: "Second" })]);

    stopFirst();

    expect(registry.getSnapshot().commands.map((item) => item.id)).toEqual(["second"]);
  });

  it("keeps recent ranking in memory only and removes stale recent ids", () => {
    const registry = new QuickActionsRegistry();
    const stop = registry.register("surface", [
      command({ id: "first", label: "First", order: 1 }),
      command({ id: "second", label: "Second", order: 2 }),
    ]);
    registry.recordRecent("second");

    const ranked = searchQuickActions(
      createQuickActionIndex(registry.getSnapshot().commands),
      "",
      registry.getSnapshot().recentCommandIds,
    );
    expect(ranked.map((item) => item.id)).toEqual(["second", "first"]);

    stop();
    expect(registry.getSnapshot().recentCommandIds).toEqual([]);
  });

  it("rejects duplicate command identities across active sources", () => {
    const registry = new QuickActionsRegistry();
    registry.register("first", [command({ id: "same", label: "First" })]);

    expect(() => registry.register("second", [command({ id: "same", label: "Second" })])).toThrow(
      "Duplicate Quick Actions command id: same",
    );
    expect(registry.getSnapshot().commands.map((item) => item.label)).toEqual(["First"]);
  });
});

describe("Quick Actions search", () => {
  const commands = [
    command({
      id: "search",
      keywords: ["find books", "library"],
      label: "Search books",
      order: 2,
    }),
    command({
      disabledReason: "Open a book to use its table of contents.",
      group: "Reader",
      id: "toc",
      keywords: ["chapters"],
      label: "Open reader TOC",
      order: 1,
    }),
  ];
  const index = createQuickActionIndex(commands);

  it("matches compact labels, keywords, groups, and disabled reasons", () => {
    expect(searchQuickActions(index, "searchbooks", []).map((item) => item.id)).toEqual(["search"]);
    expect(searchQuickActions(index, "chapters", []).map((item) => item.id)).toEqual(["toc"]);
    expect(searchQuickActions(index, "open a book", []).map((item) => item.id)).toEqual(["toc"]);
  });
});

describe("Quick Actions keyboard shortcut", () => {
  it("recognizes Ctrl+Shift+P without accepting conflicting modifiers", () => {
    expect(
      isQuickActionsShortcut(
        new KeyboardEvent("keydown", { ctrlKey: true, key: "P", shiftKey: true }),
      ),
    ).toBe(true);
    expect(
      isQuickActionsShortcut(
        new KeyboardEvent("keydown", {
          altKey: true,
          ctrlKey: true,
          key: "P",
          shiftKey: true,
        }),
      ),
    ).toBe(false);
  });
});

describe("Quick Actions text-entry detection", () => {
  it.each([
    ["text input", createElement("input", { type: "text" })],
    ["search input", createElement("input", { type: "search" })],
    ["textarea", createElement("textarea")],
    ["empty contenteditable", createElement("div", { contenteditable: "" })],
    ["true contenteditable", createElement("div", { contenteditable: "true" })],
    ["plaintext-only contenteditable", createElement("div", { contenteditable: "plaintext-only" })],
    ["textbox role", createElement("div", { role: "textbox" })],
  ])("recognizes a main-document %s", (_label, target) => {
    expect(isTextEntryTarget(target)).toBe(true);
  });

  it.each([
    ["false contenteditable", createElement("div", { contenteditable: "false" })],
    ["checkbox", createElement("input", { type: "checkbox" })],
    ["radio", createElement("input", { type: "radio" })],
    ["range", createElement("input", { type: "range" })],
    ["file input", createElement("input", { type: "file" })],
    ["button", createElement("button")],
  ])("does not classify a main-document %s as text entry", (_label, target) => {
    expect(isTextEntryTarget(target)).toBe(false);
  });

  it("respects the nearest explicit contenteditable ancestor", () => {
    const editable = createElement("div", { contenteditable: "true" });
    const nonEditableRegion = createElement("div", { contenteditable: "false" });
    const target = createElement("span");
    nonEditableRegion.append(target);
    editable.append(nonEditableRegion);

    expect(isTextEntryTarget(target)).toBe(false);
  });

  it("returns false for a target that is not an element", () => {
    expect(isTextEntryTarget(new EventTarget())).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });

  it.each([
    ["text input", createForeignRealmElement("input", { type: "text" }), true],
    ["textarea", createForeignRealmElement("textarea"), true],
    [
      "contenteditable element",
      createForeignRealmElement("div", { contenteditable: "plaintext-only" }),
      true,
    ],
    ["ordinary element", createForeignRealmElement("div"), false],
  ])("classifies a foreign-document %s without parent constructors", (_label, target, expected) => {
    expect(target).not.toBeInstanceOf(Element);
    expect(isTextEntryTarget(target)).toBe(expected);
  });
});

function createElement(
  tagName: string,
  attributes: Readonly<Record<string, string>> = {},
): HTMLElement {
  const element = document.createElement(tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

class ForeignRealmElement extends EventTarget {
  readonly nodeType = 1;
  readonly ownerDocument = {
    defaultView: {
      Element: ForeignRealmElement,
    },
  };
  parentElement: ForeignRealmElement | null = null;
  private readonly attributes = new Map<string, string>();

  constructor(
    readonly localName: string,
    attributes: Readonly<Record<string, string>>,
  ) {
    super();
    for (const [name, value] of Object.entries(attributes)) {
      this.attributes.set(name, value);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

function createForeignRealmElement(
  tagName: string,
  attributes: Readonly<Record<string, string>> = {},
): EventTarget {
  return new ForeignRealmElement(tagName, attributes);
}
