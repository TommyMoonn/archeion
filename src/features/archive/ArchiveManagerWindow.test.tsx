// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ARCHIVE_MANAGER_MAIN_CONTENT_ID, SkipLink } from "../../components/SkipLink";
import { archiveStore } from "../../stores/archiveStore";
import type { ArchiveState } from "../../stores/archiveStore";
import { ArchiveManagerFallback } from "./ArchiveManagerWindow";
import { ArchiveManagerWindowContent } from "./ArchiveManagerWindowContent";
import { ArchiveManagerWindowLoading } from "./ArchiveManagerWindowLoading";
import { completeArchiveManagerAction } from "./archiveManagerCompletion";

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
  return renderToStaticMarkup(<ArchiveManagerWindowContent state={state} />);
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
        state={state}
      />,
    );
  });

  return { container, root };
}

function buttonWithText(container: ParentNode, text: string): HTMLButtonElement {
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

    expect(markup).toContain("archive-manager-shell");
    expect(markup).toContain(`id="${ARCHIVE_MANAGER_MAIN_CONTENT_ID}"`);
    expect(markup).toContain('tabindex="-1"');
    expect(markup.match(/<main/g)).toHaveLength(1);
    expect(markup).not.toContain("archive-manager-shell--standalone");
    expect(markup).toContain("Manage archives");
    expect(markup).toContain('aria-label="Archives"');
    expect(markup).not.toContain("Known archives");
    expect(markup).not.toContain("archive-manager-window__sidebar-header");
    expect(markup).toContain("Books");
    expect(markup).toContain("Comics");
    expect(markup).toContain("D:\\Books");
    expect(markup).toContain("E:\\Comics");
    expect(markup).not.toContain("archive-row--active");
    expect(markup.match(/data-active="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
    expect(markup).toContain("archive-manager-window__icon");
    expect(markup).toContain("Create empty archive");
    expect(markup).toContain("Start with a new local folder.");
    expect(markup).toContain("Open folder as archive");
    expect(markup).toContain("Use an existing folder.");
    expect(markup).toContain('aria-label="Actions for Books"');
    expect(markup).toContain('aria-label="Actions for Comics"');
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
    expect(markup).toContain(`id="${ARCHIVE_MANAGER_MAIN_CONTENT_ID}"`);
    expect(markup.match(/<main/g)).toHaveLength(1);
    expect(markup).toContain("Manager failed to initialize.");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("archive-manager-window__sidebar--fallback");
    expect(markup).toContain("archive-manager-window__main");
  });

  it("keeps the window-local main and skip target available while the lazy manager is pending", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <>
          <SkipLink targetId={ARCHIVE_MANAGER_MAIN_CONTENT_ID} />
          <ArchiveManagerWindowLoading />
        </>,
      );
    });

    const main = container.querySelector("main");
    const skipLink = container.querySelector<HTMLAnchorElement>(".skip-link");

    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(main?.id).toBe(ARCHIVE_MANAGER_MAIN_CONTENT_ID);
    expect(main?.tabIndex).toBe(-1);
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(skipLink?.hash).toBe(`#${ARCHIVE_MANAGER_MAIN_CONTENT_ID}`);

    act(() => skipLink?.click());
    expect(document.activeElement).toBe(main);

    act(() => root.unmount());
  });

  it("keeps archive loading errors actionable without exposing internal details", () => {
    const markup = renderManager({
      archives: [],
      error: "Access denied at C:\\Private\\archives.json",
      path: null,
      status: "error",
    });

    expect(markup).toContain(
      "Archives could not be loaded. Close and reopen Archive Manager to try again.",
    );
    expect(markup).not.toContain("C:\\Private");
    expect(markup).toContain("No saved archives");
  });

  it("distinguishes registry loading from a ready empty archive list", () => {
    const loadingMarkup = renderManager({
      status: "loading",
      path: null,
      error: null,
      archives: [],
    });
    const emptyMarkup = renderManager({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });

    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(loadingMarkup).toContain('data-loading="true"');
    expect(loadingMarkup).toContain('role="status"');
    expect(loadingMarkup).toContain("Loading archives");
    expect(loadingMarkup).not.toContain("No saved archives");
    expect(emptyMarkup).not.toContain('aria-busy="true"');
    expect(emptyMarkup).toContain('data-empty="true"');
    expect(emptyMarkup).toContain("No saved archives");
    expect(emptyMarkup).toContain("Create empty archive");
    expect(emptyMarkup).toContain("Open folder as archive");
  });

  it("keeps recoverable registry errors visible without removing manager actions", () => {
    const markup = renderManager({
      status: "error",
      path: null,
      error: "The archive registry could not be read.",
      archives: [savedArchive],
    });

    expect(markup).toContain(
      "Archives could not be loaded. Close and reopen Archive Manager to try again.",
    );
    expect(markup).not.toContain("The archive registry could not be read.");
    expect(markup).toContain('data-tone="error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Comics");
    expect(markup).toContain("Create empty archive");
    expect(markup).toContain("Open folder as archive");
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

  it("describes missing archives and exposes row-owned busy state", async () => {
    let completeChoice: (() => void) | undefined;
    const onArchiveChoiceComplete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeChoice = resolve;
        }),
    );
    const missingState: ArchiveState = {
      status: "missing",
      archive: activeArchive,
      path: activeArchive.rootPath,
      error: null,
      archives: [activeArchive, savedArchive],
    };
    const { container, root } = renderInteractive({
      onArchiveChoiceComplete,
      state: missingState,
    });
    const activeButton = buttonWithText(container, "Books");
    const missingDescriptionId = activeButton.getAttribute("aria-describedby")!;

    expect(activeButton.getAttribute("aria-current")).toBe("true");
    expect(document.getElementById(missingDescriptionId)?.textContent).toContain(
      "Archive folder not found",
    );

    act(() => activeButton.click());
    const busyRow = activeButton.closest(".archive-row");
    expect(busyRow?.getAttribute("aria-busy")).toBe("true");
    expect(activeButton.disabled).toBe(true);

    await act(async () => completeChoice?.());
    expect(busyRow?.getAttribute("aria-busy")).toBeNull();

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
    expect(container.textContent).toContain(
      "Archive folder not found. Choose another archive or restore the folder.",
    );

    act(() => root.unmount());
  });

  it("opens archive actions on right-click without activating the archive", () => {
    const switchArchive = vi.spyOn(archiveStore, "switchArchive");
    const onArchiveChoiceComplete = vi.fn();
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });
    const row = Array.from(container.querySelectorAll<HTMLElement>(".archive-row")).find((item) =>
      item.textContent?.includes("Comics"),
    );

    act(() => {
      row?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 90, clientY: 70 }),
      );
    });

    expect(switchArchive).not.toHaveBeenCalled();
    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();
    const pointerLabels = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((item) => item.textContent?.trim());
    expect(pointerLabels).toEqual(["Rename archive", "Reveal archive folder", "Forget archive"]);
    expect(row?.getAttribute("data-context-menu-open")).toBe("true");

    act(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Actions for Comics"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(pointerLabels);

    act(() => root.unmount());
  });

  it("opens archive actions from keyboard context keys and focuses the first action", () => {
    const switchArchive = vi.spyOn(archiveStore, "switchArchive");
    const { container, root } = renderInteractive();
    const primary = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".archive-row__activate"),
    ).find((button) => button.textContent?.includes("Comics"));
    primary?.focus();

    act(() => {
      primary?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true }),
      );
    });

    expect(switchArchive).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toContain("Rename archive");

    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    expect(document.activeElement).toBe(primary);

    act(() => {
      primary?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu" }));
    });
    expect(document.activeElement?.textContent).toContain("Rename archive");

    act(() => root.unmount());
  });

  it("keeps rename, reveal, and forget actions inside the manager", async () => {
    const revealArchive = vi.spyOn(archiveStore, "revealArchive").mockResolvedValue(true);
    const forgetArchive = vi.spyOn(archiveStore, "forgetArchive").mockResolvedValue(true);
    const onArchiveChoiceComplete = vi.fn().mockResolvedValue(undefined);
    const { container, root } = renderInteractive({ onArchiveChoiceComplete });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Actions for Books"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      buttonWithText(document.body, "Rename archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();

    act(() => root.unmount());

    const revealSession = renderInteractive({ onArchiveChoiceComplete });
    await act(async () => {
      revealSession.container
        .querySelector<HTMLButtonElement>('[aria-label="Actions for Books"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      buttonWithText(document.body, "Reveal archive folder").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(revealArchive).toHaveBeenCalledTimes(1);
    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();

    act(() => revealSession.root.unmount());

    const forgetSession = renderInteractive({ onArchiveChoiceComplete });
    await act(async () => {
      forgetSession.container
        .querySelector<HTMLButtonElement>('[aria-label="Actions for Books"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      buttonWithText(document.body, "Forget archive").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(forgetArchive).toHaveBeenCalledTimes(1);
    expect(onArchiveChoiceComplete).not.toHaveBeenCalled();

    act(() => forgetSession.root.unmount());
  });

  it("associates an invalid inline rename and returns focus to its input", async () => {
    const { container, root } = renderInteractive();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Actions for Books"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      buttonWithText(document.body, "Rename archive").click();
    });

    const input = container.querySelector<HTMLInputElement>(".archive-row__input input")!;
    const requiredIndicator = container.querySelector<HTMLElement>(".archive-row__required")!;
    expect(input.required).toBe(true);
    expect(requiredIndicator.textContent?.trim()).toBe("Required");
    expect(requiredIndicator.getAttribute("aria-hidden")).toBe("true");

    act(() => setInputValue(input, "   "));
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    const statusId = input.getAttribute("aria-describedby");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(statusId).toBe("archive-manager-operation-status");
    expect(document.getElementById(statusId!)?.textContent).toContain(
      "Archive names cannot be empty.",
    );
    expect(document.activeElement).toBe(input);

    act(() => root.unmount());
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

    const createButton = buttonWithText(container, "Create");
    expect(createButton.disabled).toBe(false);
    await act(async () => {
      createButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const errorId = nameInput.getAttribute("aria-describedby")?.split(" ").at(-1);
    expect(nameInput.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(errorId!)?.textContent).toBe(
      "Archive name is reserved on Windows.",
    );
    expect(document.activeElement).toBe(nameInput);
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
