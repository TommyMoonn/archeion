// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusPresentationRuntime } from "../../app/inputModality";
import { AboutDialog } from "./AboutDialog";

const resolveApplicationVersion = vi.hoisted(() => vi.fn(async () => "9.9.9"));
const openExternalUrl = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../app/appVersion", () => ({
  APPLICATION_VERSION_FALLBACK: "0.6.0",
  resolveApplicationVersion,
}));

vi.mock("../../app/openExternalUrl", () => ({ openExternalUrl }));

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
  openExternalUrl.mockReset();
  openExternalUrl.mockResolvedValue(undefined);
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
  it("renders branding, the centralized fallback version, and all project destinations", () => {
    const markup = renderToStaticMarkup(<AboutDialog onClose={vi.fn()} />);

    expect(markup).toContain("Archeion");
    expect(markup).toContain("Version 0.6.0");
    expect(markup).toContain("about-window__brand");
    expect(markup).toContain("modal-surface");
    expect(markup).toContain("Website");
    expect(markup).toContain("Documentation");
    expect(markup).toContain("Source code");
    expect(markup).toContain("https://tommymoonn.github.io/archeion/");
    expect(markup).toContain("https://tommymoonn.github.io/archeion/documentation/");
    expect(markup).toContain("https://github.com/TommyMoonn/archeion");
    expect(markup).not.toContain("about-window__github");
    expect(markup).not.toContain("Version 0.2.0");
  });

  it("uses the native-approved external URL owner for every destination", async () => {
    const { container } = renderDialog();
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>(".about-window__link"));

    for (const link of links) {
      await act(async () => link.click());
    }

    expect(openExternalUrl.mock.calls).toEqual([
      ["https://tommymoonn.github.io/archeion/"],
      ["https://tommymoonn.github.io/archeion/documentation/"],
      ["https://github.com/TommyMoonn/archeion"],
    ]);
    for (const link of links) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noreferrer");
    }
  });

  it("publishes the runtime version and reports an external-open failure locally", async () => {
    openExternalUrl.mockRejectedValueOnce(new Error("unavailable"));
    const { container } = renderDialog();

    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("Version 9.9.9");

    await act(async () =>
      container.querySelector<HTMLAnchorElement>(".about-window__link")?.click(),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Archeion could not open that link.",
    );
  });

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
