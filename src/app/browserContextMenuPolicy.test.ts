// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { installBrowserContextMenuPolicy } from "./browserContextMenuPolicy";

describe("browser context-menu policy", () => {
  let stopPolicy: (() => void) | null = null;

  afterEach(() => {
    stopPolicy?.();
    stopPolicy = null;
    document.body.innerHTML = "";
  });

  function dispatchContextMenu(target: Element): MouseEvent {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 30,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("suppresses browser menus outside native text-editing controls", () => {
    stopPolicy = installBrowserContextMenuPolicy(document);
    const button = document.createElement("button");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.append(button, checkbox);

    expect(dispatchContextMenu(button).defaultPrevented).toBe(true);
    expect(dispatchContextMenu(checkbox).defaultPrevented).toBe(true);
  });

  it("preserves native editing menus for text inputs, textareas, and editable content", () => {
    stopPolicy = installBrowserContextMenuPolicy(document);
    const input = document.createElement("input");
    input.type = "search";
    const password = document.createElement("input");
    password.type = "password";
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    const nestedText = document.createElement("span");
    nestedText.textContent = "Editable text";
    editable.append(nestedText);
    document.body.append(input, password, textarea, editable);

    expect(dispatchContextMenu(input).defaultPrevented).toBe(false);
    expect(dispatchContextMenu(password).defaultPrevented).toBe(false);
    expect(dispatchContextMenu(textarea).defaultPrevented).toBe(false);
    expect(dispatchContextMenu(nestedText).defaultPrevented).toBe(false);
  });

  it("allows explicit native editing surfaces and removes its listener on cleanup", () => {
    stopPolicy = installBrowserContextMenuPolicy(document);
    const customEditor = document.createElement("div");
    customEditor.dataset.nativeContextMenu = "true";
    document.body.append(customEditor);

    expect(dispatchContextMenu(customEditor).defaultPrevented).toBe(false);

    stopPolicy();
    stopPolicy = null;
    expect(dispatchContextMenu(document.body).defaultPrevented).toBe(false);
  });
});
