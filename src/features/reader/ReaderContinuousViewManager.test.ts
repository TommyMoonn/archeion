// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { ResidentView } from "epubjs/src/managers/continuous/index.js";
import { ReaderContinuousViewManager } from "./ReaderContinuousViewManager";

function setup() {
  const manager = new ReaderContinuousViewManager({ settings: {} });
  manager.container = document.createElement("div");
  vi.spyOn(manager.container, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: 750,
    height: 750,
    left: 0,
    right: 1050,
    width: 1050,
  } as DOMRect);
  const views: ResidentView[] = [];
  manager.views = { all: () => views };
  vi.spyOn(manager, "trim").mockResolvedValue(undefined);
  vi.spyOn(manager, "erase").mockImplementation((view) => {
    view.destroy();
    views.splice(views.indexOf(view), 1);
  });
  const create = (top: number, height = 600, displayed = true) => {
    const element = document.createElement("div");
    const bounds = { top, bottom: top + height, height, left: 0, right: 1050, width: 1050 };
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => bounds as DOMRect);
    const view = {
      element,
      displayed,
      section: { index: views.length },
      display: vi.fn(async () => {
        view.displayed = true;
        return view;
      }),
      show: vi.fn(),
      destroy: vi.fn(() => {
        view.displayed = false;
      }),
    };
    views.push(view as unknown as ResidentView);
    return { view, bounds };
  };
  return { manager, create };
}

describe("Continuous warm residency", () => {
  it("notifies document retirement before the vendor clears its contents", () => {
    const manager = new ReaderContinuousViewManager({ settings: {} });
    manager.container = document.createElement("div");
    const chapter = document.implementation.createHTMLDocument("outgoing");
    const view = {
      contents: { document: chapter },
      element: document.createElement("div"),
    } as unknown as ResidentView;
    Object.assign(view, { bounds: () => view.element.getBoundingClientRect() });
    const order: string[] = [];
    manager.views = {
      remove: () => {
        order.push("destroy");
        view.contents = undefined;
      },
    } as unknown as typeof manager.views;
    manager.on("reader-view-retiring", (outgoing: ResidentView) => {
      expect(outgoing.contents?.document).toBe(chapter);
      order.push("release-hooks");
    });
    manager.erase(view, false);
    expect(order).toEqual(["release-hooks", "destroy"]);
  });
  it("bounds vertical-writing residency using the vendor's horizontal axis", async () => {
    const { manager, create } = setup();
    manager.settings.axis = "horizontal";
    const far = create(0);
    Object.assign(far.bounds, { left: -8000, right: -7000, width: 1000 });
    const huge = create(0);
    Object.assign(huge.bounds, { left: -6000, right: 400, width: 6400 });
    const next = create(0);
    Object.assign(next.bounds, { left: 1200, right: 2200, width: 1000 });
    await manager.update();
    expect(far.view.destroy).toHaveBeenCalledOnce();
    expect(huge.view.destroy).not.toHaveBeenCalled();
    expect(next.view.show).toHaveBeenCalledOnce();
  });
  it("shares an in-flight warm mount across overlapping updates", async () => {
    const { manager, create } = setup();
    const pending = create(500, 600, false);
    let finish!: () => void;
    pending.view.display.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            pending.view.displayed = true;
            resolve(pending.view);
          };
        }),
    );
    const first = manager.update();
    const second = manager.update();
    expect(pending.view.display).toHaveBeenCalledOnce();
    finish();
    await Promise.all([first, second]);
    expect(pending.view.displayed).toBe(true);
  });

  it("reports a failed warm mount to its owning session", async () => {
    const { manager, create } = setup();
    const pending = create(500, 600, false);
    const error = new Error("Synthetic iframe mount failure");
    pending.view.display.mockRejectedValue(error);
    const failed = vi.fn();
    manager.setSessionOwner(() => true, failed);
    await manager.update();
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
    expect(pending.view.show).not.toHaveBeenCalled();
  });

  it("keeps spatial neighbors and a huge intersecting chapter while unloading distant content", async () => {
    const { manager, create } = setup();
    const far = create(-6000);
    const huge = create(-4000, 4500);
    const next = create(1500);
    const distant = create(6000);
    await manager.update();
    expect(far.view.destroy).toHaveBeenCalledOnce();
    expect(distant.view.destroy).toHaveBeenCalledOnce();
    expect(huge.view.destroy).not.toHaveBeenCalled();
    expect(next.view.show).toHaveBeenCalledOnce();
  });

  it("rechecks geometry after a pending mount so a reversed-to view is not destroyed", async () => {
    const { manager, create } = setup();
    const pending = create(500, 600, false);
    const reverse = create(-6000);
    let finish!: () => void;
    pending.view.display.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            pending.view.displayed = true;
            resolve(pending.view);
          };
        }),
    );
    const update = manager.update();
    reverse.bounds.top = 0;
    reverse.bounds.bottom = 600;
    finish();
    await update;
    expect(reverse.view.destroy).not.toHaveBeenCalled();
  });

  it("does not publish, evict, or trim when an awaited render belongs to a retired session", async () => {
    const { manager, create } = setup();
    const pending = create(500, 600, false);
    const far = create(-6000);
    let finish!: () => void;
    pending.view.display.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(pending.view);
        }),
    );
    let current = true;
    manager.setSessionOwner(() => current);
    const update = manager.update();
    current = false;
    finish();
    await update;
    expect(pending.view.show).not.toHaveBeenCalled();
    expect(far.view.destroy).not.toHaveBeenCalled();
    expect(manager.trim).not.toHaveBeenCalled();
  });

  it("temporarily protects selected content and retires it after selection resolves", async () => {
    const { manager, create } = setup();
    const selected = create(-6000);
    const doc = document.implementation.createHTMLDocument();
    doc.body.textContent = "Synthetic selection";
    let isCollapsed = false;
    vi.spyOn(doc, "getSelection").mockImplementation(() => ({ isCollapsed }) as Selection);
    Object.assign(selected.view, { contents: { document: doc } });
    await manager.update();
    expect(selected.view.destroy).not.toHaveBeenCalled();
    isCollapsed = true;
    await manager.update();
    expect(selected.view.destroy).toHaveBeenCalledOnce();
  });
});
