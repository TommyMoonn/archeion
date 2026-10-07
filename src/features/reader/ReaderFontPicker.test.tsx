// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderFontPicker } from "./ReaderFontPicker";

let host: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof ReaderFontPicker>;
const pinned = [
  "Book serif (Default)",
  "Clean sans",
  "System",
  "Literata",
  "Atkinson Hyperlegible",
];
function render(changes: Partial<typeof props> = {}) {
  props = { ...props, ...changes };
  act(() => root.render(<ReaderFontPicker {...props} />));
}
function trigger() {
  return host.querySelector<HTMLButtonElement>(".app-select__trigger")!;
}
function search() {
  return host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
}
function options() {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}
function query(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search(),
      value,
    );
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  props = {
    ariaLabel: "Reader typeface",
    catalogLoading: false,
    installedFamilies: [
      "Zulu",
      "Arial",
      "literata",
      "System",
      "Book serif (Default)",
      "Atkinson Hyperlegible",
    ],
    onChange: vi.fn(),
    selection: { kind: "builtin", id: "serif" },
  };
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Reader font picker", () => {
  it("presents the five pinned presets followed directly by sorted installed families without duplicate visible labels", () => {
    act(() => trigger().click());
    expect(options().map((option) => option.textContent)).toEqual([...pinned, "Arial", "Zulu"]);
    expect(host.querySelector('[role="group"], h3, hr')).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it.each(["serif", "sans", "system", "literata", "atkinson"] as const)(
    "searches and selects builtin %s by pointer",
    (id) => {
      const index = ["serif", "sans", "system", "literata", "atkinson"].indexOf(id);
      act(() => trigger().click());
      query(pinned[index].toUpperCase());
      expect(options()).toHaveLength(1);
      act(() => options()[0].click());
      expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ kind: "builtin", id });
      expect(host.querySelector('[role="listbox"]')).toBeNull();
      expect(document.activeElement).toBe(trigger());
    },
  );

  it("searches and selects an installed family by keyboard through the same update callback", () => {
    act(() =>
      trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    query("aRiAl");
    expect(options()[0].textContent).toBe("Arial");
    act(() =>
      search().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ kind: "system", family: "Arial" });
    expect(document.activeElement).toBe(trigger());
  });

  it("keeps a saved family neutral until availability settles and preserves its unavailable contextual row", () => {
    render({
      catalogLoading: true,
      installedFamilies: [],
      selection: { kind: "system", family: "Missing Family" },
    });
    expect(trigger().textContent).toBe("Missing Family");
    act(() => trigger().click());
    query("Missing");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Loading fonts…");
    render({ catalogLoading: false });
    expect(trigger().textContent).toBe("Missing Family (Unavailable)");
    expect(options()[0].disabled).toBe(true);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    act(() => options()[0].click());
    expect(props.onChange).not.toHaveBeenCalled();
    query("not found");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("No fonts found.");
  });
});
