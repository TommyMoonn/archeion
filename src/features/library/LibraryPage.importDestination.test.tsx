// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it } from "vitest";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Folder } from "../../types/folder";
import {
  buttonWithText,
  createStorage,
  renderLibraryPage,
  setupLibraryPageTestSuite,
} from "./LibraryPage.testUtils";

describe("LibraryPage import destination", () => {
  const suite = setupLibraryPageTestSuite();

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

  it("loads the Library workspace without fetching archive destination settings", async () => {
    const storage = createStorage();
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      await Promise.resolve();
    });

    expect(storage.getArchiveImportSettings).not.toHaveBeenCalled();
  });
});
