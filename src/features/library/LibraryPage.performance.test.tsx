// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WindowTitlebarAppActionsHost } from "../../components/WindowTitlebar";
import type { ArchiveOperationWarning, StorageObserver } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import { archiveStore } from "../../stores/archiveStore";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";
import { QuickActionsProvider } from "../quick-actions/QuickActionsProvider";
import { installLibrarySidebarMedia } from "./librarySidebarMedia.testUtils";
import { LibraryPage } from "./LibraryPage";
import {
  clickBook,
  createStorage,
  openControlledContextMenu,
  renderLibraryPage,
  selectionBook,
  setupLibraryPageTestSuite,
  waitForButtonWithText,
} from "./LibraryPage.testUtils";

const gridCoverRenderCounts = vi.hoisted(() => new Map<string, number>());
const seriesCoverRenderCounts = vi.hoisted(() => new Map<string, number>());
const folderItemRenderCounts = vi.hoisted(() => new Map<string, number>());

vi.mock("./BookCover", () => ({
  BookCover: ({ book, className }: { book: Book; className?: string }) => {
    if (!className) {
      gridCoverRenderCounts.set(book.id, (gridCoverRenderCounts.get(book.id) ?? 0) + 1);
    } else if (className === "book-cover--series") {
      seriesCoverRenderCounts.set(book.id, (seriesCoverRenderCounts.get(book.id) ?? 0) + 1);
    }
    return <span data-cover-book-id={book.id} />;
  },
}));

vi.mock("../folders/FolderActionsMenu", () => ({
  FolderActionsMenu: ({ folder, showRename }: { folder: Folder; showRename?: boolean }) => {
    if (showRename === false) {
      folderItemRenderCounts.set(folder.id, (folderItemRenderCounts.get(folder.id) ?? 0) + 1);
    }
    return <span data-folder-actions-id={folder.id} />;
  },
}));

describe("LibraryPage collection callback stability", () => {
  const suite = setupLibraryPageTestSuite();

  beforeEach(() => {
    gridCoverRenderCounts.clear();
    seriesCoverRenderCounts.clear();
    folderItemRenderCounts.clear();
  });

  it("does not schedule blanket idle loading for lazy surfaces", async () => {
    const originalRequestIdleCallback = Object.getOwnPropertyDescriptor(
      window,
      "requestIdleCallback",
    );
    const originalCancelIdleCallback = Object.getOwnPropertyDescriptor(
      window,
      "cancelIdleCallback",
    );
    const requestIdleCallback = vi.fn(() => 1);
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: requestIdleCallback,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: vi.fn(),
    });
    const storage = createStorage({ books: [selectionBook("alpha", "Alpha")] });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    try {
      expect(requestIdleCallback).not.toHaveBeenCalled();
    } finally {
      if (originalRequestIdleCallback) {
        Object.defineProperty(window, "requestIdleCallback", originalRequestIdleCallback);
      } else {
        Reflect.deleteProperty(window, "requestIdleCallback");
      }
      if (originalCancelIdleCallback) {
        Object.defineProperty(window, "cancelIdleCallback", originalCancelIdleCallback);
      } else {
        Reflect.deleteProperty(window, "cancelIdleCallback");
      }
    }
  });

  it("does not rerender the book grid when book details open", async () => {
    await import("./BookDetailsDrawer");
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await act(async () => {
      clickBook(session.container, "Alpha");
    });
    await waitForButtonWithText(session.container, "Read book");

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });

  it("rerenders only the owning book when its context menu opens", async () => {
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await openControlledContextMenu(session.container, "Actions for Alpha");

    expect(gridCoverRenderCounts.get("alpha")).toBe(2);
    expect(gridCoverRenderCounts.get("beta")).toBe(1);
  });

  it("does not rerender books when operation feedback is published", async () => {
    let warningObserver: StorageObserver<ArchiveOperationWarning> | undefined;
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    storage.observeOperationWarnings = vi.fn((observer) => {
      warningObserver = observer;
      return () => {
        if (warningObserver === observer) warningObserver = undefined;
      };
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await act(async () => {
      warningObserver?.next({
        kind: "scanner-cache",
        message: "The scanner cache will be rebuilt.",
        repairRequired: false,
      });
    });

    expect(session.container.textContent).toContain("The scanner cache will be rebuilt.");
    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });

  it("does not rerender Series cards when unrelated operation feedback is published", async () => {
    await import("../series/SeriesOverview");
    let warningObserver: StorageObserver<ArchiveOperationWarning> | undefined;
    const alpha = {
      ...selectionBook("alpha", "Alpha"),
      sourceMetadata: { series: "Series Alpha", volume: "1" },
    };
    const beta = {
      ...selectionBook("beta", "Beta"),
      sourceMetadata: { series: "Series Beta", volume: "1" },
    };
    const storage = createStorage({ books: [alpha, beta] });
    storage.observeOperationWarnings = vi.fn((observer) => {
      warningObserver = observer;
      return () => {
        if (warningObserver === observer) warningObserver = undefined;
      };
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      session.container.querySelector<HTMLButtonElement>('button[aria-label="Series"]')?.click();
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => {
      expect(Object.fromEntries(seriesCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
    });

    await act(async () => {
      warningObserver?.next({
        kind: "scanner-cache",
        message: "The scanner cache will be rebuilt.",
        repairRequired: false,
      });
    });

    expect(session.container.textContent).toContain("The scanner cache will be rebuilt.");
    expect(Object.fromEntries(seriesCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });

  it("does not rerender Folder items when unrelated operation feedback is published", async () => {
    await import("../folders/FolderBrowser");
    let warningObserver: StorageObserver<ArchiveOperationWarning> | undefined;
    const folders: Folder[] = [
      {
        createdAt: "1",
        id: "alpha",
        name: "Alpha",
        parentPath: "",
        relativePath: "Alpha",
        updatedAt: "1",
      },
      {
        createdAt: "1",
        id: "beta",
        name: "Beta",
        parentPath: "",
        relativePath: "Beta",
        updatedAt: "1",
      },
    ];
    const storage = createStorage({ folders });
    storage.observeOperationWarnings = vi.fn((observer) => {
      warningObserver = observer;
      return () => {
        if (warningObserver === observer) warningObserver = undefined;
      };
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    await act(async () => {
      session.container.querySelector<HTMLButtonElement>('button[aria-label="Folders"]')?.click();
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => {
      expect(folderItemRenderCounts.get("alpha")).toBeGreaterThan(0);
      expect(folderItemRenderCounts.get("beta")).toBeGreaterThan(0);
    });
    const renderCountsBeforeFeedback = Object.fromEntries(folderItemRenderCounts);

    await act(async () => {
      warningObserver?.next({
        kind: "scanner-cache",
        message: "The scanner cache will be rebuilt.",
        repairRequired: false,
      });
    });

    expect(session.container.textContent).toContain("The scanner cache will be rebuilt.");
    expect(Object.fromEntries(folderItemRenderCounts)).toEqual(renderCountsBeforeFeedback);
  });

  it("does not rerender books when the Library sidebar changes width", async () => {
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')?.click();
    });

    expect(
      session.container.querySelector(".app-shell")?.getAttribute("data-sidebar-collapsed"),
    ).toBe("true");
    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });

  it("does not rerender books when responsive layout restores the requested sidebar state", async () => {
    const media = installLibrarySidebarMedia(false);

    try {
      const storage = createStorage({
        books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
      });
      const session = await renderLibraryPage(storage);
      suite.trackRoot(session.root);

      expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

      act(() =>
        document.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')?.click(),
      );
      act(() => media.setMatches(true));
      expect(
        document.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]'),
      ).toBeNull();

      act(() => media.setMatches(false));
      expect(
        document.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]'),
      ).not.toBeNull();
      expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
    } finally {
      media.restore();
    }
  });

  it("does not rerender books when titlebar actions open Quick Actions or reveal the archive", async () => {
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    suite.trackRoot(root);
    const revealActiveArchive = vi
      .spyOn(archiveStore, "revealActiveArchive")
      .mockResolvedValue(true);

    await act(async () => {
      root.render(
        <>
          <WindowTitlebarAppActionsHost />
          <MemoryRouter>
            <LibraryStorageContext.Provider value={storage}>
              <QuickActionsProvider>
                <LibraryPage />
              </QuickActionsProvider>
            </LibraryStorageContext.Provider>
          </MemoryRouter>
        </>,
      );
    });
    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reveal active archive folder"]')
        ?.click();
      await Promise.resolve();
    });
    expect(revealActiveArchive).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Open Quick Actions"]')
        ?.click();
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => {
      expect(document.querySelector('dialog[aria-label="Quick Actions"]')).not.toBeNull();
    });
    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });

  it("does not rerender books for an unrelated global Settings change", async () => {
    const storage = createStorage({
      books: [selectionBook("alpha", "Alpha"), selectionBook("beta", "Beta")],
    });
    const session = await renderLibraryPage(storage);
    suite.trackRoot(session.root);
    const current = appPreferencesStore.getSnapshot();

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });

    await act(async () => {
      await appPreferencesStore.update({ restoreLastReader: !current.restoreLastReader });
    });

    expect(Object.fromEntries(gridCoverRenderCounts)).toEqual({ alpha: 1, beta: 1 });
  });
});
