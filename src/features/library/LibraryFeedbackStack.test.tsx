// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryFeedbackStack } from "./LibraryFeedbackStack";
import {
  createDeleteSuccessFeedbackToken,
  LIBRARY_FEEDBACK_AUTO_DISMISS_MS,
} from "./libraryFeedback";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderStack(onDismiss = vi.fn()) {
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(
      <LibraryFeedbackStack
        onDismiss={onDismiss}
        tokens={[
          {
            id: "success",
            tone: "success",
            title: "Archive refreshed.",
            autoDismiss: true,
          },
          {
            id: "import",
            tone: "error",
            title: "Some EPUBs could not be added.",
            detail: "1 added. 1 failed.",
            details: [{ label: "Broken.epub", message: "Invalid EPUB." }],
          },
        ]}
      />,
    );
  });

  return { container, onDismiss, root };
}

let activeRoot: Root | null = null;

describe("LibraryFeedbackStack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
    vi.useRealTimers();
  });

  it("renders feedback tokens outside document flow as a fixed stack", () => {
    const session = renderStack();
    activeRoot = session.root;

    const stack = session.container.querySelector(".library-feedback");
    const tokens = session.container.querySelectorAll(".library-feedback__token");

    expect(stack).not.toBeNull();
    expect(stack?.textContent).toContain("Archive refreshed.");
    expect(stack?.textContent).toContain("Broken.epub");
    expect(stack?.textContent).toContain("Invalid EPUB.");
    expect(tokens[0]?.getAttribute("data-has-detail")).toBe("false");
    expect(tokens[1]?.getAttribute("data-has-detail")).toBe("true");
  });

  it("renders delete success tokens as non-inline auto-dismiss feedback", () => {
    const onDismiss = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <LibraryFeedbackStack
          onDismiss={onDismiss}
          tokens={[createDeleteSuccessFeedbackToken("bookDeleted")]}
        />,
      );
    });

    const stack = container.querySelector(".library-feedback");

    expect(stack?.textContent).toContain("EPUB deleted.");
    expect(container.querySelector(".library-content .library-feedback")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(LIBRARY_FEEDBACK_AUTO_DISMISS_MS);
    });

    expect(onDismiss).toHaveBeenCalledWith("library-delete-book");
  });

  it("auto-dismisses success tokens and leaves persistent errors", () => {
    const session = renderStack();
    activeRoot = session.root;

    act(() => {
      vi.advanceTimersByTime(LIBRARY_FEEDBACK_AUTO_DISMISS_MS);
    });

    expect(session.onDismiss).toHaveBeenCalledWith("success");
    expect(session.onDismiss).not.toHaveBeenCalledWith("import");
  });

  it("pauses auto-dismiss while feedback is hovered", () => {
    const session = renderStack();
    activeRoot = session.root;
    const success = session.container.querySelector<HTMLElement>(
      '.library-feedback__token[data-tone="success"]',
    )!;

    act(() => {
      vi.advanceTimersByTime(1_000);
      success.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(LIBRARY_FEEDBACK_AUTO_DISMISS_MS);
    });

    expect(session.onDismiss).not.toHaveBeenCalledWith("success");

    act(() => {
      success.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      vi.advanceTimersByTime(LIBRARY_FEEDBACK_AUTO_DISMISS_MS - 1_001);
    });
    expect(session.onDismiss).not.toHaveBeenCalledWith("success");

    act(() => vi.advanceTimersByTime(1));
    expect(session.onDismiss).toHaveBeenCalledWith("success");
  });

  it("keeps auto-dismiss paused while feedback retains focus", () => {
    const session = renderStack();
    activeRoot = session.root;
    const success = session.container.querySelector<HTMLElement>(
      '.library-feedback__token[data-tone="success"]',
    )!;
    const dismiss = success.querySelector<HTMLButtonElement>("button")!;

    act(() => {
      vi.advanceTimersByTime(1_000);
      dismiss.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      vi.advanceTimersByTime(LIBRARY_FEEDBACK_AUTO_DISMISS_MS);
    });
    expect(session.onDismiss).not.toHaveBeenCalledWith("success");

    act(() => {
      dismiss.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      vi.advanceTimersByTime(LIBRARY_FEEDBACK_AUTO_DISMISS_MS - 1_000);
    });
    expect(session.onDismiss).toHaveBeenCalledWith("success");
  });

  it("uses one live-region semantic per visible feedback token", () => {
    const session = renderStack();
    activeRoot = session.root;
    const tokens = session.container.querySelectorAll<HTMLElement>(".library-feedback__token");

    expect(tokens[0]?.getAttribute("role")).toBe("status");
    expect(tokens[1]?.getAttribute("role")).toBe("alert");
    expect(tokens[0]?.hasAttribute("aria-live")).toBe(false);
    expect(tokens[1]?.hasAttribute("aria-live")).toBe(false);
    expect(tokens[0]?.getAttribute("aria-atomic")).toBe("true");
  });

  it("dismisses tokens from the close button", () => {
    const session = renderStack();
    activeRoot = session.root;
    const buttons = session.container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Dismiss feedback"]',
    );

    act(() => buttons[1]?.click());

    expect(session.onDismiss).toHaveBeenCalledWith("import");
  });
});
