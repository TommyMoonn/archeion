// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeTransientSurfaceKind,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import { ReaderSideDrawer } from "./ReaderSideDrawer";

let root: Root;
let host: HTMLDivElement;
let frames: FrameRequestCallback[];
let animations: Array<{ transitionProperty: string; finished: Promise<void>; playState: string }>;
const originalAnimations = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getAnimations");

function deferred() {
  let resolve!: () => void;
  let reject!: () => void;
  const finished = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { finished, resolve, reject, transitionProperty: "transform", playState: "running" };
}

function render(open: boolean, children: ReactNode = <button>Navigation content</button>) {
  act(() =>
    root.render(
      <ReaderSideDrawer open={open} onDismiss={() => undefined}>
        {open ? children : null}
      </ReaderSideDrawer>,
    ),
  );
}

function beginEntry() {
  act(() => {
    const pending = frames.splice(0);
    pending.forEach((callback) => callback(0));
  });
}

async function finish(animation: ReturnType<typeof deferred>, cancel = false) {
  await act(async () => {
    if (cancel) animation.reject();
    else animation.resolve();
  });
}

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  frames = [];
  animations = [];
  document.documentElement.dataset.motion = "on";
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.splice(id - 1, 1);
  });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => animations,
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.motion;
  if (originalAnimations)
    Object.defineProperty(HTMLElement.prototype, "getAnimations", originalAnimations);
  else Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  resetTransientSurfaceOwnershipForTests();
  vi.restoreAllMocks();
});

describe("ReaderSideDrawer", () => {
  it("cancels a queued entrance when close arrives before the first frame", () => {
    render(true);
    expect(frames).toHaveLength(1);
    render(false);
    expect(frames).toHaveLength(0);
    expect(host.children).toHaveLength(0);
    expect(activeTransientSurfaceKind()).toBeNull();
  });
  it("retains only exiting content and releases interaction before visual retirement", async () => {
    const entry = deferred();
    animations = [entry];
    render(true);
    beginEntry();
    await finish(entry);
    const exit = deferred();
    animations = [exit];
    render(false);
    const layer = host.querySelector<HTMLElement>(".reader-side-surface-layer")!;
    expect(layer.hasAttribute("inert")).toBe(true);
    expect(activeTransientSurfaceKind()).toBeNull();
    expect(layer.textContent).toContain("Navigation content");
    await finish(exit);
    expect(host.children).toHaveLength(0);
  });

  it("ignores superseded entry/exit completions when a newer panel is selected", async () => {
    const entry = deferred();
    animations = [entry];
    render(true);
    beginEntry();
    const exit = deferred();
    animations = [exit];
    render(false);
    const reopened = deferred();
    animations = [reopened];
    render(true, <button>Appearance content</button>);
    await finish(entry);
    await finish(exit);
    expect(host.textContent).toBe("Appearance content");
    expect(host.querySelector("[inert]")).toBeNull();
    expect(activeTransientSurfaceKind()).toBe("reader-panel");
    await finish(reopened);
    expect(host.querySelector<HTMLElement>(".reader-side-drawer")?.dataset.state).toBe("open");
  });

  it("does not replay motion when current content is replaced", async () => {
    const entry = deferred();
    animations = [entry];
    render(true);
    beginEntry();
    await finish(entry);
    const shell = host.querySelector(".reader-side-drawer");
    render(true, <button>Search content</button>);
    expect(host.querySelector(".reader-side-drawer")).toBe(shell);
    expect((shell as HTMLElement).dataset.state).toBe("open");
    expect(frames).toEqual([]);
  });

  it("finishes without events when motion is absent or canceled", async () => {
    document.documentElement.dataset.motion = "off";
    render(true);
    expect(host.querySelector<HTMLElement>(".reader-side-drawer")?.dataset.state).toBe("open");
    const exit = deferred();
    animations = [exit];
    render(false);
    await finish(exit, true);
    expect(host.children).toHaveLength(0);
    animations = [];
    render(true);
    render(false);
    expect(host.children).toHaveLength(0);
  });

  it("ignores descendant transition events and retires on its own transform completion", () => {
    const animation = deferred();
    animations = [animation];
    render(true);
    beginEntry();
    render(false);
    const event = () => {
      const event = new Event("transitionend", { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: "transform" });
      return event;
    };
    act(() => host.querySelector("button")!.dispatchEvent(event()));
    expect(host.children).toHaveLength(1);
    // A queued entrance event cannot complete a running exit.
    act(() => host.querySelector(".reader-side-drawer")!.dispatchEvent(event()));
    expect(host.children).toHaveLength(1);
    animation.playState = "finished";
    act(() => host.querySelector(".reader-side-drawer")!.dispatchEvent(event()));
    expect(host.children).toHaveLength(0);
  });
});
