// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MAIN_CONTENT_ID, SkipLink } from "./SkipLink";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
});

describe("SkipLink", () => {
  it("is the first focusable control and moves focus to its window-owned main target", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <div className="window-app">
          <SkipLink targetId={MAIN_CONTENT_ID} />
          <button type="button">Window action</button>
          <main id={MAIN_CONTENT_ID} tabIndex={-1}>
            <h1>Library</h1>
          </main>
        </div>,
      );
    });

    const link = container.querySelector<HTMLAnchorElement>(".skip-link");
    const main = container.querySelector<HTMLElement>("main");

    expect(link?.getAttribute("href")).toBe(`#${MAIN_CONTENT_ID}`);
    expect(container.querySelector("a, button")).toBe(link);

    act(() => link?.focus());
    expect(document.activeElement).toBe(link);

    act(() => link?.click());
    expect(document.activeElement).toBe(main);
    expect(window.location.hash).toBe("");
  });

  it("does not suppress native navigation when its local target is unavailable", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(<SkipLink targetId="missing-main" />);
    });

    const link = container.querySelector<HTMLAnchorElement>(".skip-link");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    act(() => link?.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
  });
});
