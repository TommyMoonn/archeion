// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusPresentationRuntime } from "../../app/inputModality";
import { AboutDialog } from "./AboutDialog";

const resolveApplicationVersion = vi.hoisted(() => vi.fn(async () => "9.9.9"));

vi.mock("../../app/appVersion", () => ({
  APPLICATION_VERSION_FALLBACK: "0.6.0",
  resolveApplicationVersion,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };

const roots: Root[] = [];
let stopFocusPresentation: (() => void) | null = null;

function renderDialog(onClose = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<AboutDialog onClose={onClose} />));
  return { container, onClose, root };
}

beforeEach(() => {
  stopFocusPresentation = focusPresentationRuntime.start(document);
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
  resolveApplicationVersion.mockReset();
  resolveApplicationVersion.mockResolvedValue("9.9.9");
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  stopFocusPresentation?.();
  stopFocusPresentation = null;
  vi.restoreAllMocks();
});

describe("AboutDialog", () => {
  it("dismisses safely through Cancel and a true backdrop press", async () => {
    const { container, onClose } = renderDialog();
    const dialog = container.querySelector("dialog")!;
    const surface = container.querySelector(".about-window")!;

    await act(async () => Promise.resolve());

    act(() => {
      surface.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("restores a pointer opener without keyboard presentation after Escape cancellation", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    opener.focus();
    const { onClose, root } = renderDialog();

    expect(document.activeElement).toBe(document.querySelector('button[aria-label="Close About"]'));
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");
    act(() =>
      document
        .querySelector(".about-dialog")
        ?.dispatchEvent(new Event("cancel", { cancelable: true })),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);

    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");
  });

  it("restores keyboard-navigation presentation after programmatic About focus", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    opener.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    const { root } = renderDialog();
    expect(document.activeElement).toBe(document.querySelector('button[aria-label="Close About"]'));
    expect(document.documentElement.dataset.focusPresentation).toBe("programmatic");

    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-navigation");
  });
});
