// @vitest-environment happy-dom

import { open } from "@tauri-apps/plugin-dialog";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Folder } from "../../types/folder";
import {
  buttonWithText,
  createBooksLoadController,
  createStorage,
  renderLibraryPage,
  selectionBook,
  setupLibraryPageTestSuite,
  waitForButtonWithLabel,
} from "./LibraryPage.testUtils";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("LibraryPage import destination", () => {
  const suite = setupLibraryPageTestSuite();

  it("places an imported book first without remounting the Recently added collection", async () => {
    const existing = { ...selectionBook("alpha", "Alpha"), addedAt: "2026-07-01" };
    const imported = { ...selectionBook("zeta", "Zeta"), addedAt: "2026-07-02" };
    const sourcePath = "D:\\Incoming\\Zeta.epub";
    const controller = createBooksLoadController();
    const storage = createStorage({
      getLibrarySnapshot: controller.getLibrarySnapshot,
      observeLibrarySnapshot: controller.observeLibrarySnapshot,
    });
    vi.mocked(open).mockResolvedValueOnce([sourcePath]);
    vi.mocked(storage.addEpubFilesToArchive).mockImplementationOnce(async () => {
      controller.publishBooks([existing, imported]);
      return [{ status: "imported", sourcePath, fileName: "Zeta.epub", relativePath: "Zeta.epub" }];
    });
    await appPreferencesStore.updateLibraryCollection("books", { sortBy: "recently-added" });
    await import("../filesystem/AddEpubDialog");
    const { container, root } = await renderLibraryPage(storage);
    suite.trackRoot(root);
    act(() => controller.publishBooks([existing]));
    const collection = container.querySelector(".library-content--books");
    expect(collection).not.toBeNull();
    const original = await waitForButtonWithLabel(container, "View details for Alpha");
    const add = buttonWithText(container, "Add EPUB");
    const rescansBeforeImport = vi.mocked(storage.rescan).mock.calls.length;

    await act(async () => add.click());
    const dialog = container.querySelector<HTMLElement>(".dialog--add-epub");
    if (!dialog) throw new Error("The Add EPUB dialog was not rendered.");
    expect(dialog.getAttribute("aria-busy")).toBeNull();
    await act(async () => buttonWithText(dialog, "No files selected").click());
    await act(async () => buttonWithText(dialog, "Add EPUB").click());

    expect(storage.addEpubFilesToArchive).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePaths: [sourcePath] }),
    );
    expect(
      container.querySelector("[data-reader-book-id]")?.getAttribute("data-reader-book-id"),
    ).toBe("zeta");
    expect(container.querySelector(".library-content--books")).toBe(collection);
    expect(await waitForButtonWithLabel(container, "View details for Alpha")).toBe(original);
    expect(storage.rescan).toHaveBeenCalledTimes(rescansBeforeImport);
  });

  it("opens ordinary Add EPUB at archive root instead of the currently viewed folder", async () => {
    const folder: Folder = {
      id: "folder-fiction",
      name: "Fiction",
      parentId: null,
      parentPath: null,
      relativePath: "Fiction",
      createdAt: "1",
      updatedAt: "1",
    };
    const storage = createStorage({ folders: [folder] });
    const currentPreferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      import: {
        ...currentPreferences.import,
        defaultConflictAction: "skip",
        defaultMode: "move",
      },
    });
    await import("../filesystem/AddEpubDialog");
    const session = await renderLibraryPage(
      storage,
      "/?archiveId=archive-books&view=folder&folderPath=Fiction",
    );
    suite.trackRoot(session.root);

    await act(async () => {
      buttonWithText(session.container, "Add EPUB").click();
      await Promise.resolve();
    });

    expect(session.container.querySelector("#add-epub-destination-button")?.textContent).toContain(
      "Archive root",
    );
    expect(session.container.querySelector("#add-epub-conflict-button")?.textContent).toContain(
      "Skip duplicates",
    );
    expect(
      Array.from(session.container.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
        .find((button) => button.textContent === "Move")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });
});
