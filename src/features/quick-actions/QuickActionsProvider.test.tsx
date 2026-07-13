// @vitest-environment happy-dom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
import { router } from "../../app/router";
import { useRegisterQuickActions } from "./QuickActionsContext";
import { QuickActionsProvider } from "./QuickActionsProvider";
import type { QuickActionCommand, QuickActionsRegistry } from "./quickActions";

vi.mock("./QuickActionsPalette", async () => {
  const React = await import("react");

  return {
    QuickActionsPalette({
      onClose,
      onExecute,
      registry,
    }: {
      onClose: () => void;
      onExecute: (command: QuickActionCommand) => void;
      registry: QuickActionsRegistry;
    }) {
      const inputRef = React.useRef<HTMLInputElement>(null);

      React.useEffect(() => {
        inputRef.current?.focus();
      }, []);

      return (
        <div className="quick-actions">
          <input
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
                return;
              }

              if (event.key === "Enter") {
                const requestedCommandId = inputRef.current?.value.startsWith("Switch")
                  ? "archive.switch.archive-comics"
                  : "test.run";
                const command = registry
                  .getSnapshot()
                  .commands.find((candidate) => candidate.id === requestedCommandId);
                if (command) {
                  onExecute(command);
                }
              }
            }}
            ref={inputRef}
            type="search"
          />
        </div>
      );
    },
  };
});

const readyArchive: ArchiveState = {
  status: "ready",
  path: "D:\\Books",
  archive: {
    id: "archive-books",
    displayName: "Books",
    rootPath: "D:\\Books",
    createdAt: "1",
    lastOpenedAt: "2",
  },
  archives: [
    {
      id: "archive-books",
      displayName: "Books",
      rootPath: "D:\\Books",
      createdAt: "1",
      lastOpenedAt: "2",
    },
    {
      id: "archive-comics",
      displayName: "Comics",
      rootPath: "E:\\Comics",
      createdAt: "3",
      lastOpenedAt: "4",
    },
  ],
  error: null,
  watcherError: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function Harness({ onRun }: { onRun: () => void }) {
  const commands = useMemo<QuickActionCommand[]>(
    () => [
      {
        execute: onRun,
        group: "System",
        id: "test.run",
        keywords: ["custom action"],
        label: "Run test command",
      },
    ],
    [onRun],
  );
  useRegisterQuickActions("test-harness", commands);

  return (
    <div>
      <button id="palette-opener" type="button">
        Open from here
      </button>
      <input aria-label="Text field" type="text" />
    </div>
  );
}

async function renderProvider(onRun = vi.fn()) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <QuickActionsProvider>
        <Harness onRun={onRun} />
      </QuickActionsProvider>,
    );
  });

  return { container, onRun };
}

async function waitForPalette(): Promise<HTMLDialogElement> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const palette = document.querySelector<HTMLDialogElement>(".quick-actions");
    if (palette) {
      return palette;
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  throw new Error("Quick Actions palette was not rendered.");
}

beforeEach(() => {
  vi.spyOn(archiveStore, "getSnapshot").mockReturnValue(readyArchive);
  vi.spyOn(archiveStore, "subscribe").mockReturnValue(() => true);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("QuickActionsProvider", () => {
  it("opens outside text fields and restores focus after Escape", async () => {
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;
    opener.focus();

    await act(async () => {
      opener.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "P",
          shiftKey: true,
        }),
      );
    });

    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.activeElement).toBe(search);

    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(document.querySelector(".quick-actions")).toBeNull();
    expect(document.activeElement).toBe(opener);
  }, 15_000);

  it("does not open from a text-entry field", async () => {
    const rendered = await renderProvider();
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="text"]')!;

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "p",
          shiftKey: true,
        }),
      );
      await Promise.resolve();
    });

    expect(document.querySelector(".quick-actions")).toBeNull();
  });

  it("executes a registered surface command instead of duplicating its action", async () => {
    const onRun = vi.fn();
    const rendered = await renderProvider(onRun);
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    await act(async () => {
      opener.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "p",
          shiftKey: true,
        }),
      );
    });

    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => setInputValue(search, "Run test command"));
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".quick-actions")).toBeNull();
  }, 15_000);

  it("waits for an archive switch to settle before navigating once", async () => {
    const switching = deferred<boolean>();
    const switchArchive = vi
      .spyOn(archiveStore, "switchArchive")
      .mockReturnValue(switching.promise);
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(undefined);
    const rendered = await renderProvider();
    const opener = rendered.container.querySelector<HTMLButtonElement>("#palette-opener")!;

    await act(async () => {
      opener.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "p",
          shiftKey: true,
        }),
      );
    });
    const palette = await waitForPalette();
    const search = palette.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => setInputValue(search, "Switch to Comics"));
    act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(switchArchive).toHaveBeenCalledWith("archive-comics");
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => switching.resolve(true));
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledTimes(1);
    });
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
