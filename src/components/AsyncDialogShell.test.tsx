// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncDialogShell } from "./AsyncDialogShell";
import { createAsyncSurface } from "./createAsyncSurface";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let root: Root;
let container: HTMLDivElement;
function setup() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}
afterEach(() => {
  if (root) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function Editor({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Edit file"
      onClose={() => {
        if (!busy) onClose();
      }}
      feedback={<p role="status">{busy ? "Saving" : ""}</p>}
      footer={<Button onClick={onClose}>Cancel</Button>}
    >
      <input aria-label="Filename" autoFocus />
      <button onClick={() => setBusy(true)}>Save</button>
    </Dialog>
  );
}
type Module = { default: typeof Editor };

describe("async dialog lifetime", () => {
  it.each(["Cancel", "Close"])(
    "hands the focused loading %s action to its ready equivalent",
    async (label) => {
      setup();
      const pending = deferred<Module>();
      const ReadyEditor = ({ onClose }: { onClose: () => void }) => (
        <Dialog
          title="Edit file"
          onClose={onClose}
          footer={<Button onClick={onClose}>{label}</Button>}
        >
          <input aria-label="Filename" autoFocus />
        </Dialog>
      );
      const Content = createAsyncSurface(() => pending.promise);
      const onClose = vi.fn();
      act(() =>
        root.render(
          <AsyncDialogShell
            loadingContent={<input readOnly />}
            title="Edit file"
            actionLabel="Save"
            dismissLabel={label}
            onClose={onClose}
          >
            <Content onClose={onClose} />
          </AsyncDialogShell>,
        ),
      );
      const loadingDismiss = container.querySelector<HTMLButtonElement>(".dialog__footer button")!;
      act(() => loadingDismiss.focus());
      expect(document.activeElement).toBe(loadingDismiss);
      await act(async () => {
        pending.resolve({ default: ReadyEditor });
        await pending.promise;
      });
      const readyDismiss = container.querySelector<HTMLButtonElement>(".dialog__footer button")!;
      expect(readyDismiss).not.toBe(loadingDismiss);
      expect(document.activeElement).toBe(readyDismiss);
      act(() => readyDismiss.click());
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it("uses the persistent heading when a focused pending action has no ready equivalent", async () => {
    setup();
    const pending = deferred<Module>();
    const Content = createAsyncSurface(() => pending.promise);
    act(() =>
      root.render(
        <AsyncDialogShell
          loadingContent={<input readOnly />}
          title="Edit file"
          actionLabel="Save"
          onClose={vi.fn()}
        >
          <Content onClose={vi.fn()} />
        </AsyncDialogShell>,
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>(".dialog__footer button")!.focus());
    await act(async () => {
      pending.resolve({
        default: () => (
          <Dialog title="Edit file" onClose={vi.fn()}>
            <input autoFocus />
          </Dialog>
        ),
      });
      await pending.promise;
    });
    expect(document.activeElement).toBe(container.querySelector("h2"));
  });

  it("keeps one native frame and heading through slow readiness without adding controls or height rules", async () => {
    setup();
    const pending = deferred<Module>();
    const load = vi.fn(() => pending.promise);
    const Content = createAsyncSurface(load);
    expect(load).not.toHaveBeenCalled();
    const onClose = vi.fn();
    act(() =>
      root.render(
        <AsyncDialogShell
          loadingContent={<input aria-label="Loading filename" readOnly />}
          title="Edit file"
          actionLabel="Save"
          onClose={onClose}
        >
          <Content onClose={onClose} />
        </AsyncDialogShell>,
      ),
    );
    const dialog = container.querySelector("dialog")!;
    const heading = container.querySelector("h2")!;
    expect(dialog.open).toBe(true);
    expect(heading.textContent).toBe("Edit file");
    expect(container.querySelectorAll(".dialog__copy button")).toHaveLength(0);
    expect(dialog.className).not.toContain("dialog--async");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Opening");
    const close = vi.spyOn(dialog, "close");
    await act(async () => {
      pending.resolve({ default: Editor });
      await pending.promise;
    });
    expect(container.querySelectorAll("dialog")).toHaveLength(1);
    expect(container.querySelector("dialog")).toBe(dialog);
    expect(container.querySelector("h2")).toBe(heading);
    expect(document.activeElement).toBe(heading);
    expect(close).not.toHaveBeenCalled();
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Save")!
        .click(),
    );
    act(() => dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not mount retired content or steal focus from a replacement modal", async () => {
    setup();
    const pending = deferred<Module>();
    const mounted = vi.fn();
    const Content = createAsyncSurface(() => pending.promise);
    act(() =>
      root.render(
        <AsyncDialogShell
          loadingContent={<input aria-label="Loading filename" readOnly />}
          key="old"
          title="Edit file"
          actionLabel="Save"
          onClose={vi.fn()}
        >
          <Content onClose={vi.fn()} />
        </AsyncDialogShell>,
      ),
    );
    act(() =>
      root.render(
        <Dialog title="New action" onClose={vi.fn()}>
          <button autoFocus>New target</button>
        </Dialog>,
      ),
    );
    const target = container.querySelector("button")!;
    target.focus();
    await act(async () => {
      pending.resolve({
        default: () => {
          mounted();
          return <p>Old content</p>;
        },
      });
      await pending.promise;
    });
    expect(mounted).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Old content");
    expect(document.activeElement).toBe(target);
  });

  it("retains dismissible chrome after import rejection and retries with a fresh lazy identity", async () => {
    setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = deferred<Module>();
    const load = vi
      .fn<() => Promise<Module>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ default: Editor });
    const Content = createAsyncSurface(load);
    const onClose = vi.fn();
    const render = () =>
      root.render(
        <AsyncDialogShell
          loadingContent={<input aria-label="Loading filename" readOnly />}
          title="Edit file"
          actionLabel="Save"
          onClose={onClose}
        >
          <Content onClose={onClose} />
        </AsyncDialogShell>,
      );
    act(render);
    const dialog = container.querySelector("dialog")!;
    await act(async () => {
      pending.reject(new Error("Synthetic chunk failure"));
      await pending.promise.catch(() => {});
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be opened");
    expect(container.querySelector("dialog")).toBe(dialog);
    act(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Cancel")!
        .click(),
    );
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Try again")!
        .click();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(container.querySelector('input[aria-label="Filename"]')).not.toBeNull();
    expect(container.querySelector("dialog")).toBe(dialog);
    act(() => root.render(null));
    await act(async () => render());
    expect(load).toHaveBeenCalledTimes(2);
    expect(container.querySelector('input[aria-label="Filename"]')).not.toBeNull();
  });
});
