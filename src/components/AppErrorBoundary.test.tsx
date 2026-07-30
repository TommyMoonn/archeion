// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./AppErrorBoundary";
import { MAIN_CONTENT_ID } from "./SkipLink";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function ThrowingView({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("render failed");
  }

  return <p>Recovered view</p>;
}

describe("AppErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    consoleError.mockRestore();
  });

  it("renders a recovery state instead of crashing the app shell", () => {
    act(() => {
      root.render(
        <AppErrorBoundary>
          <ThrowingView shouldThrow />
        </AppErrorBoundary>,
      );
    });

    expect(container.textContent).toContain("Archeion could not load this view");
    expect(container.textContent).toContain(
      "Reload the view. If it still fails, restart Archeion.",
    );
    expect(container.textContent).toContain("Reload view");
    const main = container.querySelector("main");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(main?.id).toBe(MAIN_CONTENT_ID);
    expect(main?.tabIndex).toBe(-1);
    expect(main?.getAttribute("aria-live")).toBe("assertive");
    expect(main?.hasAttribute("role")).toBe(false);
  });

  it("uses the independently mounted window target supplied by its owner", () => {
    act(() => {
      root.render(
        <AppErrorBoundary mainContentId="secondary-window-main">
          <ThrowingView shouldThrow />
        </AppErrorBoundary>,
      );
    });

    expect(container.querySelector("main")?.id).toBe("secondary-window-main");
  });

  it("can retry rendering the child tree", () => {
    act(() => {
      root.render(
        <AppErrorBoundary>
          <ThrowingView shouldThrow />
        </AppErrorBoundary>,
      );
    });

    act(() => {
      root.render(
        <AppErrorBoundary>
          <ThrowingView shouldThrow={false} />
        </AppErrorBoundary>,
      );
    });

    const retry = container.querySelector("button");
    expect(retry).not.toBeNull();

    act(() => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Recovered view");
  });
});
