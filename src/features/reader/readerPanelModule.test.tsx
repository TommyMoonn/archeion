// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReaderPanelModule } from "./readerPanelModule";
import { ReaderPanelFrame } from "./ReaderPanelLoadingShells";
import { ReaderSidePanel } from "./ReaderSidePanel";

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(container);
});

describe("panel module readiness", () => {
  it("shares one import with prewarm and retains header, close focus and current book props", async () => {
    let resolve!: (value: { default: typeof Content }) => void;
    const load = vi.fn(
      () =>
        new Promise<{ default: typeof Content }>((done) => {
          resolve = done;
        }),
    );
    const resource = createReaderPanelModule<{ book: string }>(load);
    function Content({ book }: { book: string }) {
      return (
        <ReaderSidePanel
          accessibleLabel="ignored"
          eyebrow=""
          title="ignored"
          headerActions={<button>Domain action</button>}
        >
          <p>{book}</p>
        </ReaderSidePanel>
      );
    }
    const close = vi.fn();
    function Panel({ book, loading }: { book: string; loading: boolean }) {
      const { Component, status } = resource.useModule();
      return (
        <ReaderPanelFrame
          kind="navigation"
          readiness={status === "ready" ? (loading ? "loading" : "ready") : status}
          onClose={close}
          onModuleReload={() => undefined}
        >
          {Component ? <Component book={book} /> : null}
        </ReaderPanelFrame>
      );
    }
    await act(async () => {
      void resource.preload();
      root.render(<Panel book="old book" loading />);
    });
    const header = container.querySelector("header");
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close book navigation"]',
    )!;
    button.focus();
    await act(async () => root.render(<Panel book="current book" loading />));
    await act(async () => resolve({ default: Content }));
    expect(load).toHaveBeenCalledOnce();
    expect(container.querySelector("header")).toBe(header);
    expect(document.activeElement).toBe(button);
    expect(container.textContent).not.toContain("old book");
    expect(container.textContent).toContain("current book");
    expect(header?.textContent).toContain("Domain action");
    expect(container.querySelectorAll("aside")).toHaveLength(1);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector(".reader-panel-content")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    await act(async () => root.render(<Panel book="current book" loading={false} />));
    expect(container.querySelector(".reader-panel-content")?.hasAttribute("aria-busy")).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    act(() => button.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it("handles prewarm rejection and retries on open without an unhandled rejection", async () => {
    const Content = () => <p>Ready</p>;
    const load = vi
      .fn<() => Promise<{ default: typeof Content }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ default: Content });
    const resource = createReaderPanelModule(load);
    await resource.preload();
    function Panel() {
      const { Component, status } = resource.useModule();
      return <div>{Component ? <Component /> : status}</div>;
    }
    await act(async () => root.render(<Panel />));
    expect(container.textContent).toBe("Ready");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not remount closed content when an outstanding import resolves", async () => {
    const mounted = vi.fn();
    function Content() {
      mounted();
      return null;
    }
    let resolve!: (module: { default: typeof Content }) => void;
    const resource = createReaderPanelModule(
      () =>
        new Promise<{ default: typeof Content }>((done) => {
          resolve = done;
        }),
    );
    function Panel() {
      const { Component } = resource.useModule();
      return Component ? <Component /> : <p>Pending</p>;
    }
    await act(async () => root.render(<Panel />));
    act(() => root.render(null));
    await act(async () => resolve({ default: Content }));
    expect(container.textContent).toBe("");
    expect(mounted).not.toHaveBeenCalled();
  });
});
