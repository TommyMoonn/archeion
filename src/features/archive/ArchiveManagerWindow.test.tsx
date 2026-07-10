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
  return renderToStaticMarkup(<ArchiveManagerWindowContent standalone state={state} />);
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
        onArchiveChoiceComplete={onArchiveChoiceComplete}
        standalone
        state={state}
      />,
    );
  });

  return { container, root };
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button with text ${text} was not rendered.`);
  }

  return button;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
    expect(markup).toContain("Start with a new local folder.");
    expect(markup).toContain("Open folder as archive");
    expect(markup).toContain("Use an existing folder.");
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
      buttonWithText(container, "Books").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(switchArchive).not.toHaveBeenCalled();
    expect(onArchiveChoiceComplete).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("switches a different archive before completing the manager action", async () => {
    const switchArchive = vi.spyOn(archiveStore, "switchArchive").mockResolvedValue(true);
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      buttonWithText(container, "Comics").dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
      buttonWithText(container, "Comics").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Archive folder not found.");

    act(() => root.unmount());
  });

  it("keeps rename, reveal, and forget actions inside the manager", async () => {
    const revealArchive = vi.spyOn(archiveStore, "revealArchive").mockResolvedValue(true);
    const forgetArchive = vi.spyOn(archiveStore, "forgetArchive").mockResolvedValue(true);
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      buttonWithText(container, "Rename").dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

  it("keeps Open folder as archive on the existing folder picker flow", async () => {
    const chooseArchive = vi
      .spyOn(archiveStore, "chooseArchive")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
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

    act(() => root.unmount());
  });

  it("shows the guided create view instead of opening a folder picker", async () => {
    const chooseArchiveParentLocation = vi.spyOn(archiveStore, "chooseArchiveParentLocation");
    const createEmptyArchive = vi.spyOn(archiveStore, "createEmptyArchive");
    const { container, root } = renderInteractive();

    await act(async () => {
      buttonWithText(container, "Create empty archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("Create archive");
    expect(container.textContent).toContain("Archeion");
    expect(container.textContent).toContain("Manage archives");
    expect(container.textContent).not.toContain("Create local archive");
    expect(container.querySelector("#archive-create-name")).toBeInstanceOf(HTMLInputElement);
    expect(container.querySelector("#archive-create-name")?.getAttribute("placeholder")).toBe(
      "Light novels",
    );
    expect(container.textContent).toContain("Creates a folder with this name.");
    expect(
      container.querySelector(".archive-manager-window__content-area")?.getAttribute("data-view"),
    ).toBe("create");
    expect(
      container
        .querySelector(".archive-manager-window__content-area")
        ?.getAttribute("data-direction"),
    ).toBe("forward");
    expect(container.textContent).not.toContain("Choose a name and parent location.");
    expect(chooseArchiveParentLocation).not.toHaveBeenCalled();
    expect(createEmptyArchive).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it("browses for a parent location and preserves form state when going back", async () => {
    vi.spyOn(archiveStore, "chooseArchiveParentLocation").mockResolvedValue("D:\\Books");
    const { container, root } = renderInteractive();

    await act(async () => {
      buttonWithText(container, "Create empty archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const nameInput = container.querySelector("#archive-create-name");
    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error("Archive name input was not rendered.");
    }

    await act(async () => {
      setInputValue(nameInput, "Light Novels");
    });

    await act(async () => {
      buttonWithText(container, "Browse").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("D:\\Books");
    expect(container.textContent).toContain("D:\\Books\\Light Novels");

    await act(async () => {
      buttonWithText(container, "Back").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Manage archives");
    expect(
      container
        .querySelector(".archive-manager-window__content-area")
        ?.getAttribute("data-direction"),
    ).toBe("back");

    await act(async () => {
      buttonWithText(container, "Create empty archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const restoredInput = container.querySelector("#archive-create-name");
    expect(restoredInput).toBeInstanceOf(HTMLInputElement);
    expect((restoredInput as HTMLInputElement).value).toBe("Light Novels");
    expect(container.textContent).toContain("D:\\Books");

    act(() => root.unmount());
  });

  it("keeps the create form open when Browse is canceled", async () => {
    vi.spyOn(archiveStore, "chooseArchiveParentLocation").mockResolvedValue(null);
    const { container, root } = renderInteractive();

    await act(async () => {
      buttonWithText(container, "Create empty archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    await act(async () => {
      buttonWithText(container, "Browse").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Create archive");
    expect(container.textContent).toContain("Choose a parent folder");
    expect(container.textContent).not.toContain("Create local archive");

    act(() => root.unmount());
  });

  it("rejects invalid archive names before invoking the backend", async () => {
    vi.spyOn(archiveStore, "chooseArchiveParentLocation").mockResolvedValue("D:\\Books");
    const createEmptyArchive = vi.spyOn(archiveStore, "createEmptyArchive");
    const { container, root } = renderInteractive();

    await act(async () => {
      buttonWithText(container, "Create empty archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const nameInput = container.querySelector("#archive-create-name");
    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error("Archive name input was not rendered.");
    }

    await act(async () => {
      setInputValue(nameInput, "CON");
    });

    await act(async () => {
      buttonWithText(container, "Browse").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(buttonWithText(container, "Create").disabled).toBe(true);
    expect(container.textContent).toContain("Archive name is reserved on Windows.");
    expect(createEmptyArchive).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it("creates a valid archive with separate name and parent path", async () => {
    vi.spyOn(archiveStore, "chooseArchiveParentLocation").mockResolvedValue("D:\\Books");
    const createEmptyArchive = vi.spyOn(archiveStore, "createEmptyArchive").mockResolvedValue(true);
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      buttonWithText(container, "Create empty archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const nameInput = container.querySelector("#archive-create-name");
    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error("Archive name input was not rendered.");
    }

    await act(async () => {
      setInputValue(nameInput, "Light Novels");
    });

    await act(async () => {
      buttonWithText(container, "Browse").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      buttonWithText(container, "Create").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(createEmptyArchive).toHaveBeenCalledWith({
      archiveName: "Light Novels",
      parentPath: "D:\\Books",
    });
    expect(onArchiveChoiceComplete).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("keeps the create form open and surfaces creation failure", async () => {
    vi.spyOn(archiveStore, "chooseArchiveParentLocation").mockResolvedValue("D:\\Books");
    vi.spyOn(archiveStore, "createEmptyArchive").mockResolvedValue(false);
    vi.spyOn(archiveStore, "getLastOperationError").mockReturnValue(
      "Archive folder already exists.",
    );
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      buttonWithText(container, "Create empty archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const nameInput = container.querySelector("#archive-create-name");
    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error("Archive name input was not rendered.");
    }

    await act(async () => {
      setInputValue(nameInput, "Light Novels");
    });

    await act(async () => {
      buttonWithText(container, "Browse").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      buttonWithText(container, "Create").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Archive folder already exists.");
    expect(container.textContent).toContain("Create archive");
    expect(container.textContent).not.toContain("Create local archive");
    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});

describe("completeArchiveManagerAction", () => {
  it("closes the manager so the window lifecycle can resume startup", async () => {
    const closeCurrentWindow = vi.fn().mockResolvedValue(undefined);
    await expect(
      completeArchiveManagerAction({
        closeCurrentWindow,
        currentWindowLabel: "archive-manager",
        isDesktop: true,
      }),
    ).resolves.toBe(true);

    expect(closeCurrentWindow).toHaveBeenCalledTimes(1);
  });

  it("does not close another window", async () => {
    const closeCurrentWindow = vi.fn().mockResolvedValue(undefined);

    await expect(
      completeArchiveManagerAction({
        closeCurrentWindow,
        currentWindowLabel: "main",
        isDesktop: true,
      }),
    ).resolves.toBe(false);

    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });
});
