// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OpenArchiveButton } from "./OpenArchiveButton";

const chooseArchive = vi.hoisted(() => vi.fn());
vi.mock("../../stores/archiveStore", () => ({ archiveStore: { chooseArchive } }));

it("retains the archive action and one live status through a slow open and cancellation", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finish!: (opened: boolean) => void;
  chooseArchive.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const onOpened = vi.fn();
  act(() => root.render(<OpenArchiveButton onOpened={onOpened} />));
  const button = container.querySelector("button")!;
  const slot = container.querySelector(".button__icon");
  const live = container.querySelector('[role="status"]')!;
  act(() => {
    button.click();
    button.click();
  });
  expect(chooseArchive).toHaveBeenCalledOnce();
  expect(button.textContent).toBe("Open folder as archive");
  expect(button.disabled).toBe(true);
  expect(live.textContent).toBe("Opening archive…");
  await act(async () => finish(false));
  expect(button.disabled).toBe(false);
  expect(onOpened).not.toHaveBeenCalled();
  expect(container.querySelector(".button__icon")).toBe(slot);
  expect(container.querySelector('[role="status"]')).toBe(live);
  expect(live.textContent).toBe("");
  act(() => button.click());
  await act(async () => finish(true));
  expect(onOpened).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(false);
  act(() => root.unmount());
  container.remove();
});
