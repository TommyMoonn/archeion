// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ReaderTypefaceSelect } from "./ReaderTypefaceSelect";

it("displays a saved system family honestly and emits structured builtin changes by keyboard", () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const onChange = vi.fn();
  try {
    act(() =>
      root.render(
        <ReaderTypefaceSelect
          ariaLabel="Reader typeface"
          selection={{ kind: "system", family: "Missing Family" }}
          onChange={onChange}
        />,
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Reader typeface"]')!;
    expect(trigger.textContent).toContain("Missing Family");
    trigger.focus();
    act(() =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onChange).toHaveBeenCalledWith({ kind: "builtin", id: "serif" });
    expect(document.activeElement).toBe(trigger);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
