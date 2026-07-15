// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "../../components/Dialog";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import {
  ThemePreviewSession,
  type ThemePreviewHandle,
  type ThemePreviewRuntime,
} from "../../themes/ThemePreviewSession";
import { ThemePreviewControls } from "./ThemePreviewControls";

const archive = Object.freeze({
  generation: 3,
  id: "archive-a",
  rootPath: "D:\\Archive A",
});

function candidate(lowContrast = false) {
  return {
    schemaVersion: 1,
    id: "preview-theme",
    name: "Midnight Draft",
    base: "dark",
    app: lowContrast
      ? { main: "#000000", text: "#000000" }
      : { accent: "#123456", text: "#ffffff" },
    reader: { base: "sepia", background: "#f0e0c0" },
  };
}

function createSession() {
  const listeners = new Set<() => void>();
  const clearPreview = vi.fn(() => true);
  const keepPreview = vi.fn(async () => undefined);
  const runtime: ThemePreviewRuntime = {
    applyPreview: vi.fn(() => true),
    clearPreview,
    getPreviewContext: () => ({
      archive,
      settings: {
        appTheme: { kind: "inherit" },
        readerTheme: { kind: "inherit" },
      },
    }),
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("dark"),
      archive,
      reader: resolveBuiltInReaderTheme("dark"),
    }),
    keepPreview,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { clearPreview, keepPreview, session: new ThemePreviewSession(runtime) };
}

function NativeDialogPreviewOwner({
  handle,
  session,
}: Readonly<{ handle: ThemePreviewHandle; session: ThemePreviewSession }>) {
  useEffect(() => () => void handle.dispose(), [handle]);

  return (
    <Dialog
      closeOnBackdropClick={false}
      onClose={() => void handle.dispose()}
      title="Theme Manager"
    >
      <div>Theme details</div>
      <ThemePreviewControls session={session} />
    </Dialog>
  );
}

describe("ThemePreviewControls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("is not globally mounted by App", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/app/App.tsx"), "utf8");

    expect(appSource).not.toContain("ThemePreviewControls");
  });

  it("renders nothing without a preview and uses a complete safe built-in control palette", async () => {
    const { session } = createSession();
    act(() => root.render(<ThemePreviewControls session={session} />));
    expect(container.textContent).toBe("");

    await act(async () => {
      const started = session.startPreview({
        candidate: candidate(),
        channels: { application: true, reader: true },
      });
      expect(started.ok).toBe(true);
    });

    const controls = container.querySelector<HTMLElement>(".theme-preview-controls");
    const safeTheme = resolveBuiltInAppTheme("dark");
    expect(controls).not.toBeNull();
    expect(controls?.style.getPropertyValue("--surface")).toBe(safeTheme.tokens.surface);
    expect(controls?.style.getPropertyValue("--text")).toBe(safeTheme.tokens.text);
    expect(controls?.style.getPropertyValue("--focus")).toBe(safeTheme.tokens.focus);
    expect(controls?.style.getPropertyValue("--shadow-popover")).toBe(
      safeTheme.tokens.popoverShadow,
    );
    expect(container.textContent).toContain("Midnight Draft");
    expect(document.activeElement?.textContent).toContain("Revert");
  });

  it("renders inside an explicit native-dialog owner with Revert focused and Escape available", async () => {
    const { clearPreview, session } = createSession();
    const started = session.startPreview({
      candidate: candidate(),
      channels: { application: true, reader: true },
    });
    if (!started.ok) throw new Error(started.reason);

    act(() => root.render(<NativeDialogPreviewOwner handle={started.handle} session={session} />));

    const dialog = container.querySelector("dialog")!;
    const controls = container.querySelector<HTMLElement>(".theme-preview-controls")!;
    expect(dialog.contains(controls)).toBe(true);
    expect(document.activeElement?.textContent).toContain("Revert");

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(clearPreview).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toEqual({ status: "idle" });
  });

  it("lets the native-dialog owner dispose its preview handle on unmount", () => {
    const { clearPreview, session } = createSession();
    const started = session.startPreview({
      candidate: candidate(),
      channels: { application: false, reader: true },
    });
    if (!started.ok) throw new Error(started.reason);

    act(() => root.render(<NativeDialogPreviewOwner handle={started.handle} session={session} />));
    act(() => root.unmount());

    expect(clearPreview).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toEqual({ status: "idle" });
    root = createRoot(container);
  });

  it("leaves preview-handle cleanup with the owner when presentation alone unmounts", () => {
    const { clearPreview, session } = createSession();
    const started = session.startPreview({
      candidate: candidate(),
      channels: { application: true, reader: false },
    });
    if (!started.ok) throw new Error(started.reason);
    act(() => root.render(<ThemePreviewControls session={session} />));

    act(() => root.unmount());

    expect(clearPreview).not.toHaveBeenCalled();
    expect(started.handle.dispose()).toBe(true);
    expect(clearPreview).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  it("keeps warning acknowledgement and failed-Keep retry accessible", async () => {
    const { keepPreview, session } = createSession();
    keepPreview.mockRejectedValueOnce(new Error("disk unavailable"));
    act(() => root.render(<ThemePreviewControls session={session} />));
    await act(async () => {
      const started = session.startPreview({
        candidate: candidate(true),
        channels: { application: true, reader: false },
      });
      expect(started.ok).toBe(true);
    });

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const keep = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Keep theme"),
    )!;
    expect(container.textContent).toContain("contrast warning");
    expect(keep.getAttribute("aria-disabled")).toBe("true");

    act(() => {
      checkbox.click();
    });
    expect(keep.getAttribute("aria-disabled")).toBeNull();

    await act(async () => {
      keep.click();
    });
    expect(keepPreview).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "preview is still active",
    );
    expect(checkbox.checked).toBe(true);
    expect(keep.getAttribute("aria-disabled")).toBeNull();

    await act(async () => {
      keep.click();
    });
    expect(keepPreview).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("");
  });
});
