// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { isTextEntryTarget } from "./appCommands";

describe("application command text-entry detection", () => {
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
