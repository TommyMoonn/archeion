// @vitest-environment happy-dom

import { open } from "@tauri-apps/plugin-dialog";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddEpubDialog } from "./AddEpubDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

let activeRoot: Root | null = null;
const openMock = vi.mocked(open);

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button with text ${text} was not rendered.`);
  }
  return button;
}

async function renderDialog(
  confirmDestructiveFileActions: boolean,
  importAction: () => Promise<void> = async () => undefined,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  activeRoot = root;
  const onClose = vi.fn();
  const onImport = vi.fn(importAction);

  await act(async () => {
    root.render(
      <AddEpubDialog
        confirmDestructiveFileActions={confirmDestructiveFileActions}
        folders={[]}
        importDefaults={{ defaultConflictAction: "replace", defaultMode: "copy" }}
        onClose={onClose}
        onImport={onImport}
      />,
    );
  });

  await act(async () => {
    buttonWithText(container, "No files selected").click();
  });

  return { container, onClose, onImport };
}

describe("AddEpubDialog replacement confirmation", () => {
  beforeEach(() => {
    openMock.mockResolvedValue("D:\\Incoming\\Book.epub");
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("requires an explicit confirmation before replacement when enabled", async () => {
    const { container, onClose, onImport } = await renderDialog(true);

    await act(async () => {
      buttonWithText(container, "Add EPUB").click();
    });

    expect(onImport).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Replace existing EPUB files?");

    await act(async () => {
      buttonWithText(container, "Replace and add").click();
    });
    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ conflictAction: "replace" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the selected Replace action directly when confirmations are disabled", async () => {
    const { container, onClose, onImport } = await renderDialog(false);

    const operationGroup = container.querySelector<HTMLElement>(
      '.add-epub-dialog__field[role="group"]',
    );
    expect(operationGroup?.getAttribute("aria-labelledby")).toBe("add-epub-operation-label");
    expect(document.getElementById("add-epub-operation-label")?.textContent).toBe("Operation");

    await act(async () => {
      buttonWithText(container, "Add EPUB").click();
    });

    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ conflictAction: "replace" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Replace existing EPUB files?");
  });

  it("keeps a rejected submission and its selected file in one dialog-owned alert", async () => {
    const { container, onClose } = await renderDialog(false, async () => {
      throw new Error("The archive is read-only.");
    });

    await act(async () => {
      buttonWithText(container, "Add EPUB").click();
      await Promise.resolve();
    });

    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toContain("The archive is read-only.");
    expect(container.textContent).toContain("Book.epub");
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps sustained import progress inside the loaded dialog", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <AddEpubDialog
          folders={[]}
          initialSourcePaths={["D:\\Incoming\\Book.epub"]}
          isImporting
          onClose={onClose}
          onImport={vi.fn(async () => undefined)}
        />,
      );
    });

    const adding = buttonWithText(container, "Adding");
    const cancel = buttonWithText(container, "Cancel");

    expect(container.querySelector("dialog[open]")).not.toBeNull();
    expect(container.querySelector(".dialog-loading-fallback")).toBeNull();
    expect(adding.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    act(() => cancel.click());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("defaults ordinary imports to archive root while preserving global import defaults", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;
    const onImport = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <AddEpubDialog
          confirmDestructiveFileActions={false}
          folders={[
            {
              id: "folder-fiction",
              name: "Fiction",
              relativePath: "Fiction",
              parentId: null,
              parentPath: null,
              createdAt: "1",
              updatedAt: "1",
            },
          ]}
          importDefaults={{ defaultConflictAction: "skip", defaultMode: "move" }}
          initialSourcePaths={["D:\\Incoming\\Book.epub"]}
          onClose={vi.fn()}
          onImport={onImport}
        />,
      );
    });

    expect(container.querySelector("#add-epub-destination-button")?.textContent).toContain(
      "Archive root",
    );
    expect(container.querySelector("#add-epub-conflict-button")?.textContent).toContain(
      "Skip duplicates",
    );
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
        .find((button) => button.textContent === "Move")
        ?.getAttribute("aria-checked"),
    ).toBe("true");

    await act(async () => buttonWithText(container, "Add EPUB").click());

    expect(onImport).toHaveBeenCalledWith({
      conflictAction: "skip",
      destinationFolderPath: undefined,
      mode: "move",
      sourcePaths: ["D:\\Incoming\\Book.epub"],
    });
  });

  it("sends a changed destination for the current import", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;
    const onImport = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <AddEpubDialog
          confirmDestructiveFileActions={false}
          folders={[
            {
              id: "folder-fiction",
              name: "Fiction",
              relativePath: "Fiction",
              parentId: null,
              parentPath: null,
              createdAt: "1",
              updatedAt: "1",
            },
          ]}
          importDefaults={{ defaultConflictAction: "keepBoth", defaultMode: "copy" }}
          initialSourcePaths={["D:\\Incoming\\Book.epub"]}
          onClose={vi.fn()}
          onImport={onImport}
        />,
      );
    });

    const destination = container.querySelector<HTMLButtonElement>("#add-epub-destination-button");
    if (!destination) throw new Error("Destination control was not rendered.");

    await act(async () => destination.click());
    const fiction = Array.from(
      container.querySelectorAll<HTMLButtonElement>("#add-epub-destination-menu [role=option]"),
    ).find((option) => option.textContent?.includes("Fiction"));
    if (!fiction) throw new Error("Fiction destination was not rendered.");
    await act(async () => fiction.click());
    await act(async () => buttonWithText(container, "Add EPUB").click());

    expect(onImport).toHaveBeenCalledWith({
      conflictAction: "keepBoth",
      destinationFolderPath: "Fiction",
      mode: "copy",
      sourcePaths: ["D:\\Incoming\\Book.epub"],
    });

    await act(async () => {
      root.render(
        <AddEpubDialog
          key="next-import"
          confirmDestructiveFileActions={false}
          folders={[
            {
              id: "folder-fiction",
              name: "Fiction",
              relativePath: "Fiction",
              parentId: null,
              parentPath: null,
              createdAt: "1",
              updatedAt: "1",
            },
          ]}
          importDefaults={{ defaultConflictAction: "keepBoth", defaultMode: "copy" }}
          initialSourcePaths={["D:\\Incoming\\Next.epub"]}
          onClose={vi.fn()}
          onImport={vi.fn(async () => undefined)}
        />,
      );
    });

    expect(container.querySelector("#add-epub-destination-button")?.textContent).toContain(
      "Archive root",
    );
  });

  it("prefills dropped EPUB paths and their target folder before confirmation", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;
    const onImport = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <AddEpubDialog
          confirmDestructiveFileActions={false}
          folders={[
            {
              id: "folder-fiction",
              name: "Fiction",
              relativePath: "Fiction",
              parentId: null,
              parentPath: null,
              createdAt: "1",
              updatedAt: "1",
            },
          ]}
          importDefaults={{ defaultConflictAction: "skip", defaultMode: "copy" }}
          initialFolderPath="Fiction"
          initialSourcePaths={["D:\\Incoming\\One.epub", "D:\\Incoming\\Two.epub"]}
          onClose={vi.fn()}
          onImport={onImport}
        />,
      );
    });

    expect(container.textContent).toContain("2 selected");
    expect(container.textContent).toContain("Fiction");
    await act(async () => buttonWithText(container, "Add EPUB").click());
    expect(onImport).toHaveBeenCalledWith({
      conflictAction: "skip",
      destinationFolderPath: "Fiction",
      mode: "copy",
      sourcePaths: ["D:\\Incoming\\One.epub", "D:\\Incoming\\Two.epub"],
    });
  });
});
