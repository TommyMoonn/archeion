// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "./Button";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("suppresses busy activation and keeps the action name and indicator slot across outcomes", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const click = vi.fn();
  const render = (busy: boolean) =>
    act(() =>
      root.render(
        <Button busy={busy} onClick={click}>
          Write cover to EPUB
        </Button>,
      ),
    );
  render(false);
  const slot = container.querySelector(".button__icon");
  expect(slot).not.toBeNull();
  render(true);
  const button = container.querySelector("button")!;
  expect(button.textContent).toBe("Write cover to EPUB");
  expect(button.getAttribute("aria-busy")).toBe("true");
  act(() => button.click());
  expect(click).not.toHaveBeenCalled();
  expect(button.disabled).toBe(true);
  render(false);
  expect(container.querySelector(".button__icon")).toBe(slot);
  act(() => button.click());
  expect(click).toHaveBeenCalledOnce();
  act(() => root.unmount());
});

it("reveals only sustained work and cancels the reveal on settlement or unmount", () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (busy: boolean) => act(() => root.render(<Button busy={busy}>Move</Button>));
  render(true);
  act(() => vi.advanceTimersByTime(80));
  expect(container.querySelector('[data-visible="true"]')).toBeNull();
  render(false);
  act(() => vi.advanceTimersByTime(500));
  expect(container.querySelector(".button__busy")).toBeNull();
  render(true);
  act(() => vi.advanceTimersByTime(200));
  expect(container.querySelector('.button__busy[data-visible="true"]')).not.toBeNull();
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps ordinary controls free of indicators and owns a live region only when requested", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Button>Cancel</Button>));
  expect(container.querySelector(".button__icon")).toBeNull();
  expect(container.querySelector('[role="status"]')).toBeNull();
  act(() =>
    root.render(
      <Button busy={false} busyStatus="Opening archive…">
        Open archive
      </Button>,
    ),
  );
  const status = container.querySelector('[role="status"]')!;
  expect(status.textContent).toBe("");
  act(() =>
    root.render(
      <Button busy busyStatus="Opening archive…" disabledReason="Wait">
        Open archive
      </Button>,
    ),
  );
  expect(container.querySelector('[role="status"]')).toBe(status);
  expect(status.textContent).toBe("Opening archive…");
  expect(container.querySelector("button")!.disabled).toBe(true);
  act(() => root.unmount());
});
