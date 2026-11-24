// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateSelectOption } from "../test/activateSelectOption";
import { AppSelect, type AppSelectOption } from "./AppSelect";

const options: AppSelectOption<string>[] = [
  { label: "Any", value: "" },
  { label: "No more options", value: "none", disabled: true },
  { label: "Author", value: "author" },
];
let root: Root | undefined;
let host: HTMLDivElement;
const onChange = vi.fn();
function render(items = options, value = "") {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root?.render(
      <AppSelect ariaLabel="Filter" options={items} value={value} onChange={onChange} />,
    ),
  );
  return host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  onChange.mockClear();
});

describe("AppSelect popup ownership", () => {
  it("keeps the popup inside the owning control and preserves empty-string selection", async () => {
    const trigger = render();
    await act(async () => trigger.click());
    const popup = host.querySelector('[role="listbox"]')!;
    expect(trigger.closest(".app-select")?.contains(popup)).toBe(true);
    const rows = popup.querySelectorAll<HTMLElement>('[role="option"]');
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    expect(rows[1].getAttribute("aria-disabled")).toBe("true");
    await act(async () => activateSelectOption(rows[1]));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => activateSelectOption(rows[2]));
    expect(onChange).toHaveBeenCalledWith("author");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("updates available choices while open without changing the selected value", async () => {
    const trigger = render();
    await act(async () => trigger.click());
    render([
      { label: "Any", value: "" },
      { label: "Series", value: "series" },
    ]);
    expect(Array.from(host.querySelectorAll('[role="option"]'), (row) => row.textContent)).toEqual([
      "Any",
      "Series",
    ]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
