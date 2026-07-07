// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { archiveStore } from "../../stores/archiveStore";
import type { ArchiveState } from "../../stores/archiveStore";
import { ArchiveManagerFallback } from "./ArchiveManagerWindow";
import { ArchiveManagerWindowContent } from "./ArchiveManagerWindowContent";
import { completeArchiveManagerAction } from "./archiveManagerCompletion";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const activeArchive = {
  id: "archive-books",
  displayName: "Books",
  rootPath: "D:\\Books",
  createdAt: "1",
  lastOpenedAt: "2",
};

const savedArchive = {
  id: "archive-comics",
  displayName: "Comics",
  rootPath: "E:\\Comics",
  createdAt: "1",
  lastOpenedAt: "1",
};

const readyState: ArchiveState = {
  status: "ready",
  path: activeArchive.rootPath,
  archive: activeArchive,
  error: null,
  watcherError: null,
  archives: [activeArchive, savedArchive],
};

function renderManager(state: ArchiveState = readyState) {
  return renderToStaticMarkup(
    <ArchiveManagerWindowContent mode="manager" standalone state={state} />,
  );
}

function renderInteractive({
  onArchiveChoiceComplete = () => undefined,
  state = readyState,
}: {
  onArchiveChoiceComplete?: () => void | Promise<unknown>;
  state?: ArchiveState;
} = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ArchiveManagerWindowContent
        mode="manager"
        onArchiveChoiceComplete={onArchiveChoiceComplete}
        standalone
        state={state}
      />,
    );
  });

  return { container, root };
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button with text ${text} was not rendered.`);
  }

  return button;
}

describe("ArchiveManagerWindow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the manager surface for the separate window", () => {
    const markup = renderManager();

    expect(markup).toContain("archive-manager-shell--standalone");
    expect(markup).toContain("Manage archives");
    expect(markup).toContain('aria-label="Archives"');
    expect(markup).not.toContain("Known archives");
    expect(markup).not.toContain("archive-manager-window__sidebar-header");
    expect(markup).toContain("Books");
    expect(markup).toContain("Comics");
    expect(markup).toContain("D:\\Books");
    expect(markup).toContain("E:\\Comics");
    expect(markup).not.toContain("archive-row--active");
    expect(markup).not.toContain('aria-current="page"');
    expect(markup).toContain("archive-manager-window__icon");
    expect(markup).toContain("Create empty archive");
    expect(markup).toContain("Open folder as archive");
    expect(markup).toContain("Rename");
    expect(markup).toContain("Reveal in folder");
    expect(markup).toContain("Forget");
    expect(markup).not.toContain("archive-manager-window__chrome");
    expect(markup).not.toContain(">Archive Manager<");
    expect(markup).not.toContain("Active");
    expect(markup).not.toContain("Current");
    expect(markup).not.toContain("Reveal folder");
    expect(markup).not.toContain("Forget archive");
    expect(markup).not.toContain(">2</span>");
    expect(markup).not.toContain("Open another archive");
    expect(markup).not.toContain("Back to Library");
    expect(markup.toLowerCase()).not.toContain("vault");
  });

  it("shows a visible fallback when initialization fails", () => {
    const markup = renderToStaticMarkup(
      <ArchiveManagerFallback message="Manager failed to initialize." />,
    );

    expect(markup).toContain("Archive Manager");
    expect(markup).toContain("Manager failed to initialize.");
    expect(markup).toContain('role="alert"');
  });

  it("treats the current archive as a close-and-focus action", async () => {
    const switchArchive = vi.spyOn(archiveStore, "switchArchive");
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      buttonWithText(container, "Books").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(switchArchive).not.toHaveBeenCalled();
    expect(onArchiveChoiceComplete).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("switches a different archive before completing the manager action", async () => {
    const switchArchive = vi
      .spyOn(archiveStore, "switchArchive")
      .mockResolvedValue(true);
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      buttonWithText(container, "Comics").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(switchArchive).toHaveBeenCalledWith(savedArchive.id);
    expect(onArchiveChoiceComplete).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("keeps the manager open when archive activation fails", async () => {
    vi.spyOn(archiveStore, "switchArchive").mockResolvedValue(false);
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      buttonWithText(container, "Comics").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Archive folder not found.");

    act(() => root.unmount());
  });


  it("keeps rename, reveal, and forget actions inside the manager", async () => {
    const revealArchive = vi
      .spyOn(archiveStore, "revealArchive")
      .mockResolvedValue(true);
    const forgetArchive = vi
      .spyOn(archiveStore, "forgetArchive")
      .mockResolvedValue(true);
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      buttonWithText(container, "Rename").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();

    act(() => root.unmount());

    const revealSession = renderInteractive({ onArchiveChoiceComplete });
    await act(async () => {
      buttonWithText(revealSession.container, "Reveal in folder").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(revealArchive).toHaveBeenCalledTimes(1);
    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();

    act(() => revealSession.root.unmount());

    const forgetSession = renderInteractive({ onArchiveChoiceComplete });
    await act(async () => {
      buttonWithText(forgetSession.container, "Forget").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(forgetArchive).toHaveBeenCalledTimes(1);
    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();

    act(() => forgetSession.root.unmount());
  });

  it("completes the manager action after successful create or open flows", async () => {
    const chooseArchive = vi
      .spyOn(archiveStore, "chooseArchive")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const createArchive = vi
      .spyOn(archiveStore, "createArchive")
      .mockResolvedValue(true);
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      buttonWithText(container, "Open folder as archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(chooseArchive).toHaveBeenCalledTimes(1);
    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();

    await act(async () => {
      buttonWithText(container, "Open folder as archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onArchiveChoiceComplete).toHaveBeenCalledTimes(1);

    await act(async () => {
      buttonWithText(container, "Create empty archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(createArchive).toHaveBeenCalledTimes(1);
    expect(onArchiveChoiceComplete).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });
});

describe("completeArchiveManagerAction", () => {
  it("focuses the main window before closing the manager window", async () => {
    const calls: string[] = [];

    await expect(
      completeArchiveManagerAction({
        closeCurrentWindow: async () => {
          calls.push("close");
        },
        currentWindowLabel: "archive-manager",
        focusMainWindow: async () => {
          calls.push("focus");
          return true;
        },
        isDesktop: true,
      }),
    ).resolves.toBe(true);

    expect(calls).toEqual(["focus", "close"]);
  });

  it("does not close another window or close after focus failure", async () => {
    const closeCurrentWindow = vi.fn().mockResolvedValue(undefined);

    await expect(
      completeArchiveManagerAction({
        closeCurrentWindow,
        currentWindowLabel: "main",
        focusMainWindow: vi.fn().mockResolvedValue(true),
        isDesktop: true,
      }),
    ).resolves.toBe(false);

    await expect(
      completeArchiveManagerAction({
        closeCurrentWindow,
        currentWindowLabel: "archive-manager",
        focusMainWindow: vi.fn().mockResolvedValue(false),
        isDesktop: true,
      }),
    ).resolves.toBe(false);

    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });
});
