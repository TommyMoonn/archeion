// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetTransientSurfaceOwnershipForTests } from "../../utils/transientSurfaceOwnership";
import { ReaderExternalLinkDialog } from "./ReaderExternalLinkDialog";

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  resetTransientSurfaceOwnershipForTests();
  vi.restoreAllMocks();
});

describe("ReaderExternalLinkDialog", () => {
  it("shows the destination host and requires explicit confirmation", () => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    act(() => {
      root.render(
        <ReaderExternalLinkDialog
          host="example.com"
          onCancel={onCancel}
          onConfirm={onConfirm}
          opening={false}
          url="https://example.com/source"
        />,
      );
    });

    expect(container.textContent).toContain("example.com");
    expect(container.textContent).toContain("https://example.com/source");
    act(() =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Open in browser")
        ?.click(),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("dismisses safely through the global Escape fallback without a Reader controller", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onCancel = vi.fn();

    act(() => {
      root.render(
        <ReaderExternalLinkDialog
          host="example.com"
          onCancel={onCancel}
          onConfirm={vi.fn()}
          opening={false}
          url="https://example.com/source"
        />,
      );
    });
    escape();

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledWith(true);
  });
});

function escape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
  });
}
