// @vitest-environment happy-dom

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ARCHIVE_ROOT_DESTINATION } from "../filesystem/archiveImport";
import {
  createStorage,
  renderLibraryPage,
  setupLibraryPageTestSuite,
} from "./LibraryPage.testUtils";

type DropCallbacks = {
  onDrop: (sourcePaths: string[], destinationValue: string) => void;
  onInvalidDrop: (message: string) => void;
};

let dropCallbacks: DropCallbacks | null = null;

vi.mock("../filesystem/useExternalEpubDrop", () => ({
  useExternalEpubDrop: (callbacks: DropCallbacks) => {
    dropCallbacks = callbacks;
    return { activeTarget: null };
  },
}));

describe("LibraryPage external EPUB drag and drop", () => {
  const suite = setupLibraryPageTestSuite();

  beforeEach(() => {
    dropCallbacks = null;
  });

  it("routes invalid drops through the library feedback stack", async () => {
    const session = await renderLibraryPage(createStorage());
    suite.trackRoot(session.root);

    await act(async () => {
      dropCallbacks?.onInvalidDrop("Only EPUB files can be added.");
    });

    expect(session.container.textContent).toContain("These items cannot be added.");
    expect(session.container.textContent).toContain("Only EPUB files can be added.");
  });

  it("opens the existing import dialog with dropped EPUB paths", async () => {
    const session = await renderLibraryPage(createStorage());
    suite.trackRoot(session.root);
    await import("../filesystem/AddEpubDialog");

    await act(async () => {
      dropCallbacks?.onDrop(["C:\\Incoming\\Dropped.epub"], ARCHIVE_ROOT_DESTINATION);
      await Promise.resolve();
    });

    const dialog = session.container.querySelector("dialog");
    expect(dialog?.textContent).toContain("Add EPUB files");
    expect(dialog?.textContent).toContain("Dropped.epub");
  });
});
