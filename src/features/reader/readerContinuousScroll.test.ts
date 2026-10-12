// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import epubPackage from "epubjs/package.json";
import { stabilizeContinuousRendition, type RenditionWithManager } from "./readerContinuousScroll";

function setup() {
  const listeners = new Map<string, () => void>();
  const display = vi.fn<(request: unknown) => Promise<void>>(async () => undefined);
  const show = vi.fn();
  const view = { display, displayed: false, show };
  const manager = {
    container: document.createElement("div"),
    check: vi.fn(async () => undefined),
    counter: vi.fn(),
    request: {},
    update: vi.fn(async () => undefined),
    views: { all: () => [view] },
  };
  const rendition = {
    manager,
    on: vi.fn((event: string, callback: () => void) => listeners.set(event, callback)),
    off: vi.fn((event: string) => listeners.delete(event)),
  };
  return { rendition: rendition as unknown as RenditionWithManager, manager, listeners, view };
}

describe("Continuous rendition integration", () => {
  it("pins the retained private update seam to the behavior-tested vendor version", () => {
    expect(epubPackage.version).toBe("0.3.93");
  });

  it("retains loaded views without wrapping vendor check or compensation", async () => {
    const { rendition, manager, view } = setup();
    const check = manager.check;
    const counter = manager.counter;
    stabilizeContinuousRendition(rendition, () => true);
    await manager.update();
    expect(view.display).toHaveBeenCalledWith(manager.request);
    expect(view.show).toHaveBeenCalledOnce();
    expect(manager.check).toBe(check);
    expect(manager.counter).toBe(counter);
  });

  it("configures only the owned outer scroller when it attaches and releases the subscription", () => {
    const { rendition, manager, listeners } = setup();
    const release = stabilizeContinuousRendition(rendition, () => true);
    const attached = document.createElement("div");
    manager.container = attached;
    listeners.get("attached")!();
    expect(attached.style.overflowAnchor).toBe("none");
    expect(document.body.style.overflowAnchor).toBe("");
    release();
    expect(listeners.size).toBe(0);
  });

  it("does not show an awaited view or start another update after session retirement", async () => {
    const { rendition, manager, listeners, view } = setup();
    let resolveDisplay!: () => void;
    view.display.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDisplay = resolve;
        }),
    );
    let current = true;
    stabilizeContinuousRendition(rendition, () => current);
    const pending = manager.update();
    current = false;
    const replacement = document.createElement("div");
    manager.container = replacement;
    listeners.get("attached")!();
    resolveDisplay();
    await pending;
    await manager.update();
    expect(view.display).toHaveBeenCalledOnce();
    expect(view.show).not.toHaveBeenCalled();
    expect(replacement.style.overflowAnchor).toBe("");
  });
});
