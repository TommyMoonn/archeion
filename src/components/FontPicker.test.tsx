// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FontPicker, type FontPickerProps } from "./FontPicker";
import { registerTransientSurface } from "../utils/transientSurfaceOwnership";

let root: Root;
let container: HTMLDivElement;
let props: FontPickerProps;
const catalog = Object.freeze(["Zulu", "Beta Sans", "Alpha Serif"]);
const pinned = Object.freeze([
  { value: "default", label: "Default choice" },
  { value: "inherit", label: "Follow interface" },
]);

function render(overrides: Partial<FontPickerProps> = {}) {
  props = { ...props, ...overrides };
  act(() => root.render(<FontPicker {...props} />));
}

function trigger() {
  return container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
}
function search() {
  return container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
}
function options() {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));
}
function active() {
  return document.getElementById(search().getAttribute("aria-activedescendant") ?? "");
}
function open() {
  act(() => trigger().click());
}
function key(key: string, isComposing = false) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, isComposing });
  act(() => search().dispatchEvent(event));
  return event;
}
function query(value: string) {
  act(() => {
    const input = search();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    ariaLabel: "Family",
    installedFamilies: catalog,
    pinnedOptions: pinned,
    value: { kind: "pinned", value: "default" },
    onChange: vi.fn(),
  };
  render();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("FontPicker", () => {
  it("keeps a saved name neutral while the catalog is loading and leaves pinned choices usable", () => {
    render({
      catalogLoading: true,
      installedFamilies: [],
      value: { kind: "system", family: "Arial" },
    });
    expect(trigger().getAttribute("aria-label")).toBe("Family: Arial");
    expect(trigger().getAttribute("aria-busy")).toBe("true");
    open();
    query("Arial");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading fonts…");
    expect(options()).toEqual([]);
    render({ catalogLoading: false, installedFamilies: ["Arial"] });
    expect(trigger().getAttribute("aria-busy")).toBeNull();
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect(props.onChange).not.toHaveBeenCalled();
    render({
      catalogLoading: true,
      installedFamilies: [],
      value: { kind: "system", family: "Missing" },
    });
    query("");
    act(() => options()[0].click());
    expect(props.onChange).toHaveBeenCalledWith({ kind: "pinned", value: "default" });
  });
  it("opens with a named search field focused and pinned rows before sorted installed families", () => {
    open();
    expect(document.activeElement).toBe(search());
    expect(search().placeholder).toBe("Search fonts…");
    expect(search().getAttribute("aria-controls")).toBe(
      container.querySelector('[role="listbox"]')!.id,
    );
    expect(options().map((row) => row.textContent)).toEqual([
      "Default choice",
      "Follow interface",
      "Alpha Serif",
      "Beta Sans",
      "Zulu",
    ]);
    expect(catalog).toEqual(["Zulu", "Beta Sans", "Alpha Serif"]);
  });

  it("filters pinned and installed visible labels with case-insensitive substring matching", () => {
    open();
    query("ER");
    expect(options().map((row) => row.textContent)).toEqual(["Follow interface", "Alpha Serif"]);
    query("  SANS  ");
    expect(options().map((row) => row.textContent)).toEqual(["Beta Sans"]);
    query("");
    expect(options()[0].textContent).toBe("Default choice");
  });

  it("keeps search focus while arrows move and wrap active rows independently of selection", () => {
    open();
    expect(active()).toBe(options()[0]);
    key("ArrowDown");
    expect(active()).toBe(options()[1]);
    expect(document.activeElement).toBe(search());
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect(options()[1].getAttribute("aria-selected")).toBe("false");
    key("ArrowUp");
    key("ArrowUp");
    expect(active()).toBe(options().at(-1));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("selects a pinned option on Enter immediately, closes and restores the trigger", () => {
    open();
    key("ArrowDown");
    key("Enter");
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ kind: "pinned", value: "inherit" });
    expect(search()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("selects a system family through pointer with the same callback and close behavior", () => {
    open();
    const row = options()[3];
    act(() => {
      row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      row.click();
    });
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ kind: "system", family: "Beta Sans" });
    expect(search()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("dismisses with Escape without selection and resets the query when reopened", () => {
    open();
    query("beta");
    key("Escape");
    expect(search()).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
    open();
    expect(search().value).toBe("");
  });

  it("selects catalog casing while finding a stored system selection case-insensitively", () => {
    render({ value: { kind: "system", family: "beta sans" } });
    expect(trigger().textContent).toBe("Beta Sans");
    open();
    expect(active()).toBe(options()[3]);
    expect(options().filter((row) => row.getAttribute("aria-selected") === "true")).toEqual([
      options()[3],
    ]);
    key("Enter");
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ kind: "system", family: "Beta Sans" });
  });

  it("suppresses visible-label collisions only when requested, preserving pinned order", () => {
    render({ pinnedOptions: [{ value: "alias", label: "bETA sANS" }, ...pinned] });
    open();
    expect(options()).toHaveLength(6);
    render({ suppressInstalledDuplicates: true });
    expect(options().map((row) => row.textContent)).toEqual([
      "bETA sANS",
      "Default choice",
      "Follow interface",
      "Alpha Serif",
      "Zulu",
    ]);
  });

  it("represents unavailable current families without altering the catalog or selecting them", () => {
    render({ value: { kind: "system", family: "Missing Family" } });
    expect(trigger().textContent).toBe("Missing Family (Unavailable)");
    open();
    const missing = options().at(-1)!;
    expect(missing.textContent).toBe("Missing Family (Unavailable)");
    expect(missing.getAttribute("aria-selected")).toBe("true");
    expect(missing.getAttribute("aria-disabled")).toBe("true");
    act(() => missing.click());
    expect(props.onChange).not.toHaveBeenCalled();
    expect(search()).not.toBeNull();
    key("ArrowUp");
    expect(active()?.textContent).toBe("Zulu");
    expect(catalog).toHaveLength(3);
    query("Missing");
    expect(search().hasAttribute("aria-activedescendant")).toBe(false);
    key("Enter");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("announces an empty result without adding a fake selectable option", () => {
    open();
    query("does-not-exist");
    expect(options()).toEqual([]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("No fonts found.");
    expect(search().hasAttribute("aria-activedescendant")).toBe(false);
    key("ArrowDown");
    key("Enter");
    expect(props.onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(search());
  });

  it("leaves native text editing and IME confirmation alone", () => {
    open();
    for (const name of ["Home", "End", " ", "ArrowLeft", "ArrowRight"])
      expect(key(name).defaultPrevented).toBe(false);
    expect(key("Enter", true).defaultPrevented).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("dismisses outside pointer and focus departures without stealing destination focus", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    open();
    act(() => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      outside.focus();
    });
    expect(search()).toBeNull();
    expect(document.activeElement).toBe(outside);
    open();
    act(() => outside.focus());
    expect(search()).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("closes on modal ownership and does not reopen after being disabled and re-enabled", () => {
    open();
    const modal = document.createElement("div");
    document.body.append(modal);
    let unregister = () => {};
    act(() => {
      unregister = registerTransientSurface({
        element: modal,
        kind: "app-dialog",
        modal: true,
        onDismiss: vi.fn(),
      });
    });
    expect(search()).toBeNull();
    act(() => unregister());
    open();
    render({ disabled: true });
    expect(search()).toBeNull();
    expect(trigger().disabled).toBe(true);
    render({ disabled: false });
    expect(search()).toBeNull();
  });

  it("recovers active-row identity when caller data changes while open", () => {
    open();
    query("sans");
    expect(active()?.textContent).toBe("Beta Sans");
    render({ installedFamilies: ["Other Sans"] });
    expect(active()?.textContent).toBe("Other Sans");
    key("Enter");
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({
      kind: "system",
      family: "Other Sans",
    });
  });

  it("supports pinned-only and installed-only configurations without role policy", () => {
    render({ installedFamilies: [] });
    open();
    expect(options()).toHaveLength(2);
    key("Escape");
    render({
      installedFamilies: catalog,
      pinnedOptions: [],
      value: { kind: "system", family: "Alpha Serif" },
    });
    open();
    expect(options()).toHaveLength(3);
    expect(active()?.textContent).toBe("Alpha Serif");
  });
});
