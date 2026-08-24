// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it } from "vitest";

import {
  createBooksLoadController,
  createStorage,
  renderLibraryPage,
  selectionBook,
  setInputValue,
  setupLibraryPageTestSuite,
  waitForButtonWithLabel,
} from "./LibraryPage.testUtils";

describe("LibraryPage shell state integration", () => {
  const suite = setupLibraryPageTestSuite();

  it("keeps the same shell and collection owner from initial loading through true empty", async () => {
    const loadController = createBooksLoadController();
    const session = await renderLibraryPage(
      createStorage({
        getLibrarySnapshot: loadController.getLibrarySnapshot,
        observeLibrarySnapshot: loadController.observeLibrarySnapshot,
      }),
    );
    suite.trackRoot(session.root);

    const outerShell = session.container.querySelector(".app-shell");
    const shell = session.container.querySelector(".page-shell");
    const sidebar = session.container.querySelector(".sidebar");
    const titlebarActions = session.container.querySelector(".library-titlebar-composition");
    const loadingContent = session.container.querySelector(".collection-content");

    expect(outerShell).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(titlebarActions).not.toBeNull();
    expect(loadingContent?.getAttribute("data-surface-state")).toBe("loading");
    expect(loadingContent?.getAttribute("aria-busy")).toBe("true");

    act(() => loadController.publishModel([], []));

    expect(session.container.querySelector(".app-shell")).toBe(outerShell);
    expect(session.container.querySelector(".page-shell")).toBe(shell);
    expect(session.container.querySelector(".sidebar")).toBe(sidebar);
    expect(session.container.querySelector(".library-titlebar-composition")).toBe(titlebarActions);
    const emptyContent = session.container.querySelector(".collection-content");
    expect(emptyContent?.className).toBe(loadingContent?.className);
    expect(emptyContent?.getAttribute("data-surface-state")).toBe("empty");
    expect(emptyContent?.querySelector(".empty-state")).not.toBeNull();
  });

  it("keeps the last ready books rendered while a rescan is active", async () => {
    const book = selectionBook("book-alpha", "Alpha");
    const loadController = createBooksLoadController([], [book]);
    const session = await renderLibraryPage(
      createStorage({
        getLibrarySnapshot: loadController.getLibrarySnapshot,
        observeLibrarySnapshot: loadController.observeLibrarySnapshot,
      }),
    );
    suite.trackRoot(session.root);

    act(() => loadController.publishModel([book], []));
    const outerShell = session.container.querySelector(".app-shell");
    const shell = session.container.querySelector(".page-shell");
    const bookTarget = session.container.querySelector(
      'button[aria-label="View details for Alpha"]',
    );

    expect(bookTarget).not.toBeNull();
    expect(
      session.container.querySelector(".collection-content")?.getAttribute("data-surface-state"),
    ).toBe("results");

    act(() => loadController.startLoading());

    expect(session.container.querySelector(".app-shell")).toBe(outerShell);
    expect(session.container.querySelector(".page-shell")).toBe(shell);
    expect(session.container.querySelector('button[aria-label="View details for Alpha"]')).toBe(
      bookTarget,
    );
    expect(
      session.container.querySelector(".collection-content")?.getAttribute("data-surface-state"),
    ).toBe("results");
    expect(session.container.textContent).not.toContain("Loading library");
  });

  it("distinguishes a true empty archive from an empty search without replacing the shell", async () => {
    const session = await renderLibraryPage(createStorage());
    suite.trackRoot(session.root);

    const shell = session.container.querySelector(".page-shell");
    const content = session.container.querySelector(".collection-content");
    const search = session.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    );

    expect(content?.getAttribute("data-surface-state")).toBe("empty");
    expect(search).not.toBeNull();

    await act(async () => {
      setInputValue(search!, "missing");
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    expect(session.container.querySelector(".page-shell")).toBe(shell);
    const searchEmptyContent = session.container.querySelector(".collection-content");
    expect(searchEmptyContent?.className).toBe(content?.className);
    expect(searchEmptyContent?.getAttribute("data-surface-state")).toBe("search-empty");
    expect(searchEmptyContent?.textContent).toContain("No search results");
    expect(searchEmptyContent?.textContent).toContain("Clear search");
  });

  it("keeps the Folder shell mounted while initial loading becomes ready empty", async () => {
    const loadController = createBooksLoadController();
    const session = await renderLibraryPage(
      createStorage({
        getLibrarySnapshot: loadController.getLibrarySnapshot,
        observeLibrarySnapshot: loadController.observeLibrarySnapshot,
      }),
      "/?view=folders&archiveId=archive-books",
    );
    suite.trackRoot(session.root);

    const shell = session.container.querySelector(".page-shell");
    const loadingContent = session.container.querySelector(".folder-browser__content");

    expect(loadingContent?.getAttribute("data-surface-state")).toBe("loading");
    expect(loadingContent?.getAttribute("aria-busy")).toBe("true");
    expect(loadingContent?.textContent).toContain("Loading folders");
    expect(loadingContent?.textContent).not.toContain("No folders");

    act(() => loadController.publishModel([], []));

    expect(session.container.querySelector(".page-shell")).toBe(shell);
    const emptyContent = session.container.querySelector(".folder-browser__content");
    expect(emptyContent?.getAttribute("data-surface-state")).toBe("empty");
    expect(emptyContent?.textContent).toContain("No folders");
  });

  it("keeps existing Folder entries mounted during a rescan", async () => {
    const folder = {
      createdAt: "1",
      id: "folder-fiction",
      name: "Fiction",
      parentId: null,
      parentPath: null,
      relativePath: "Fiction",
      updatedAt: "1",
    };
    const loadController = createBooksLoadController([folder]);
    const session = await renderLibraryPage(
      createStorage({
        getLibrarySnapshot: loadController.getLibrarySnapshot,
        observeLibrarySnapshot: loadController.observeLibrarySnapshot,
      }),
      "/?view=folders&archiveId=archive-books",
    );
    suite.trackRoot(session.root);

    act(() => loadController.publishModel([], [folder]));
    const folderTarget = session.container.querySelector(".folder-browser__open");

    expect(folderTarget?.textContent).toContain("Fiction");
    expect(
      session.container
        .querySelector(".folder-browser__content")
        ?.getAttribute("data-surface-state"),
    ).toBe("results");

    act(() => loadController.startLoading());

    expect(session.container.querySelector(".folder-browser__open")).toBe(folderTarget);
    expect(
      session.container
        .querySelector(".folder-browser__content")
        ?.getAttribute("data-surface-state"),
    ).toBe("results");
    expect(session.container.textContent).not.toContain("Loading folders");
  });

  it("keeps the Series shell mounted while initial loading becomes ready empty", async () => {
    const loadController = createBooksLoadController();
    const session = await renderLibraryPage(
      createStorage({
        getLibrarySnapshot: loadController.getLibrarySnapshot,
        observeLibrarySnapshot: loadController.observeLibrarySnapshot,
      }),
      "/?view=series&archiveId=archive-books",
    );
    suite.trackRoot(session.root);
    await waitForButtonWithLabel(session.container, "Sort series");

    const shell = session.container.querySelector(".page-shell");
    const loadingContent = session.container.querySelector(".series-overview__content");

    expect(loadingContent?.getAttribute("data-surface-state")).toBe("loading");
    expect(loadingContent?.getAttribute("aria-busy")).toBe("true");
    expect(
      loadingContent?.querySelector('[role="status"][aria-label="Loading series"]'),
    ).not.toBeNull();
    expect(loadingContent?.textContent).not.toContain("No series metadata");

    act(() => loadController.publishModel([], []));

    expect(session.container.querySelector(".page-shell")).toBe(shell);
    const emptyContent = session.container.querySelector(".series-overview__content");
    expect(emptyContent?.getAttribute("data-surface-state")).toBe("empty");
    expect(emptyContent?.textContent).toContain("No series metadata");
  });

  it("keeps existing Series entries mounted during a rescan", async () => {
    const seriesBook = {
      ...selectionBook("series-volume-1", "Star Saga Volume 1"),
      sourceMetadata: { series: "Star Saga", volume: "1" },
    };
    const loadController = createBooksLoadController([], [seriesBook]);
    const session = await renderLibraryPage(
      createStorage({
        getLibrarySnapshot: loadController.getLibrarySnapshot,
        observeLibrarySnapshot: loadController.observeLibrarySnapshot,
      }),
      "/?view=series&archiveId=archive-books",
    );
    suite.trackRoot(session.root);
    await waitForButtonWithLabel(session.container, "Sort series");

    act(() => loadController.publishModel([seriesBook], []));
    const seriesTarget = session.container.querySelector('button[aria-label="Open Star Saga"]');

    expect(seriesTarget).not.toBeNull();
    expect(
      session.container
        .querySelector(".series-overview__content")
        ?.getAttribute("data-surface-state"),
    ).toBe("results");

    act(() => loadController.startLoading());

    expect(session.container.querySelector('button[aria-label="Open Star Saga"]')).toBe(
      seriesTarget,
    );
    expect(
      session.container
        .querySelector(".series-overview__content")
        ?.getAttribute("data-surface-state"),
    ).toBe("results");
    expect(session.container.textContent).not.toContain("Loading series");
  });
});
