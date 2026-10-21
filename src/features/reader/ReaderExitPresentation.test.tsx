// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ReaderExitPresentation } from "./ReaderExitPresentation";

it("keeps waiting quiet and focus-neutral; only explicit failure supplies recovery", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const trigger = document.body.appendChild(document.createElement("button"));
  trigger.focus();
  const root = createRoot(container);
  const onReturn = vi.fn();
  try {
    act(() =>
      root.render(<ReaderExitPresentation failure={null} toolbarExpanded onReturn={onReturn} />),
    );
    expect(container.querySelector("h1, header, button, [role=alert]")).toBeNull();
    expect(container.querySelector("[role=status]")?.textContent).toBe("Returning to Library…");
    expect(document.activeElement).toBe(trigger);
    act(() =>
      root.render(
        <ReaderExitPresentation failure="rejected" toolbarExpanded onReturn={onReturn} />,
      ),
    );
    expect(container.querySelectorAll("button")).toHaveLength(1);
    const recovery = container.querySelector("button")!;
    expect(document.activeElement).toBe(recovery);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("could not be opened");
    act(() => recovery.click());
    expect(onReturn).toHaveBeenCalledOnce();
    act(() =>
      root.render(<ReaderExitPresentation failure={null} toolbarExpanded onReturn={onReturn} />),
    );
    expect(container.querySelector("button, [role=alert], h1")).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    trigger.remove();
  }
});
