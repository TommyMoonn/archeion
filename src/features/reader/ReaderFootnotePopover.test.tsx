// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderFootnotePopover } from "./ReaderFootnotePopover";

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ReaderFootnotePopover", () => {
  it("anchors in the reader viewport, enters focus, routes links, and dismisses with Escape", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const action = {
      kind: "internal" as const,
      target: {
        displayTarget: "Text/chapter-2.xhtml",
        documentHref: "Text/chapter-2.xhtml",
        resourceKind: "document" as const,
      },
    };

    act(() => {
      root.render(
        <ReaderFootnotePopover
          anchorRect={{ bottom: 110, height: 20, left: 100, right: 140, top: 90, width: 40 }}
          content={{
            nodes: [{ children: [{ text: "Next", type: "text" }], action, type: "link" }],
            release: vi.fn(),
          }}
          onAction={onAction}
          onDismiss={onDismiss}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    const popover = container.querySelector<HTMLElement>(".reader-footnote")!;
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close footnote"]')!;
    const link = container.querySelector<HTMLButtonElement>(".reader-footnote__link")!;
    expect(popover.dataset.placement).toBe("below");
    expect(document.activeElement).toBe(close);
    act(() =>
      close.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Tab",
          shiftKey: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(link);
    act(() =>
      link.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" }),
      ),
    );
    expect(document.activeElement).toBe(close);
    act(() => link.click());
    expect(onAction).toHaveBeenCalledWith(action);
    act(() =>
      popover.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      ),
    );
    expect(onDismiss).toHaveBeenCalledWith(true);
  });

  it("dismisses a parent outside pointer once without restoring EPUB focus", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onDismiss = vi.fn();

    act(() => {
      root.render(
        <ReaderFootnotePopover
          anchorRect={{ bottom: 110, height: 20, left: 100, right: 140, top: 90, width: 40 }}
          message="A note"
          onAction={vi.fn()}
          onDismiss={onDismiss}
          viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
        />,
      );
    });

    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith(false);
  });
});
