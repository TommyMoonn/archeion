// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FontPicker, type FontPickerProps } from "./FontPicker";
import { TooltipProvider } from "./Tooltip";
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
  act(() =>
    root.render(
      <TooltipProvider>
        <FontPicker {...props} />
      </TooltipProvider>,
    ),
  );
}

function trigger() {
  return container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
}
function search() {
  return container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
}
function options() {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
}
function active() {
  return document.getElementById(search().getAttribute("aria-activedescendant") ?? "");
}
async function open() {
  await act(async () => {
    trigger().focus();
    trigger().click();
  });
}
function key(key: string, isComposing = false) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, isComposing });
  act(() => search().dispatchEvent(event));
  return event;
}
async function query(value: string) {
  await act(async () => {
    const input = search();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
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
  it("uses the styled tooltip for a truncated selected font name instead of a native title", async () => {
    render({ value: { kind: "system", family: "A very long installed font family name" } });

    expect(trigger().getAttribute("title")).toBeNull();
    const descriptionId = trigger().getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      "A very long installed font family name (Unavailable)",
    );
  });

  it("keeps a saved name neutral while the catalog is loading and leaves pinned choices usable", async () => {
    render({
      catalogLoading: true,
      installedFamilies: [],
      value: { kind: "system", family: "Arial" },
    });
    expect(trigger().getAttribute("aria-label")).toBe("Family: Arial");
    expect(trigger().getAttribute("aria-busy")).toBe("true");
    await open();
    await query("Arial");
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
    await query("");
    act(() => options()[0].click());
    expect(props.onChange).toHaveBeenCalledWith({ kind: "pinned", value: "default" });
  });

  it("opens a named search field with pinned rows before sorted installed families", async () => {
    await open();
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

  it("filters pinned and installed visible labels with case-insensitive substring matching", async () => {
    await open();
    await query("ER");
    expect(options().map((row) => row.textContent)).toEqual(["Follow interface", "Alpha Serif"]);
    await query("  SANS  ");
    expect(options().map((row) => row.textContent)).toEqual(["Beta Sans"]);
    await query("");
    expect(options()[0].textContent).toBe("Default choice");
  });

  it("selects a system family through pointer with the same callback and close behavior", async () => {
    await open();
    const row = options()[3];
    act(() => {
      row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      row.click();
    });
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ kind: "system", family: "Beta Sans" });
    expect(search()).toBeNull();
  });

  it("dismisses with Escape without selection and resets the query when reopened", async () => {
    await open();
    await query("beta");
    key("Escape");
    expect(search()).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
    await open();
    expect(search().value).toBe("");
  });

  it("selects catalog casing while finding a stored system selection case-insensitively", async () => {
    render({ value: { kind: "system", family: "beta sans" } });
    expect(trigger().textContent).toBe("Beta Sans");
    await open();
    expect(options().filter((row) => row.getAttribute("aria-selected") === "true")).toEqual([
      options()[3],
    ]);
    act(() => options()[3].click());
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ kind: "system", family: "Beta Sans" });
  });

  it("suppresses visible-label collisions only when requested, preserving pinned order", async () => {
    render({ pinnedOptions: [{ value: "alias", label: "bETA sANS" }, ...pinned] });
    await open();
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

  it("represents unavailable current families without altering the catalog or selecting them", async () => {
    render({ value: { kind: "system", family: "Missing Family" } });
    expect(trigger().textContent).toBe("Missing Family (Unavailable)");
    await open();
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
    await query("Missing");
    expect(options()[0].getAttribute("aria-disabled")).toBe("true");
    key("Enter");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("announces an empty result without adding a fake selectable option", async () => {
    await open();
    await query("does-not-exist");
    expect(options()).toEqual([]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("No fonts found.");
    expect(search().hasAttribute("aria-activedescendant")).toBe(false);
    key("ArrowDown");
    key("Enter");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("closes on modal ownership and does not reopen after being disabled and re-enabled", async () => {
    await open();
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
    await open();
    render({ disabled: true });
    expect(search()).toBeNull();
    expect(trigger().disabled).toBe(true);
    render({ disabled: false });
    expect(search()).toBeNull();
  });

  it("recovers active-row identity when caller data changes while open", async () => {
    await open();
    await query("sans");
    expect(active()?.textContent).toBe("Beta Sans");
    render({ installedFamilies: ["Other Sans"] });
    expect(active()?.textContent).toBe("Other Sans");
    key("Enter");
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({
      kind: "system",
      family: "Other Sans",
    });
  });

  it("supports pinned-only and installed-only configurations without role policy", async () => {
    render({ installedFamilies: [] });
    await open();
    expect(options()).toHaveLength(2);
    key("Escape");
    render({
      installedFamilies: catalog,
      pinnedOptions: [],
      value: { kind: "system", family: "Alpha Serif" },
    });
    await open();
    expect(options()).toHaveLength(3);
  });
});
