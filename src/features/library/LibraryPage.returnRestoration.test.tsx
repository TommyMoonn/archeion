// @vitest-environment happy-dom

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { archiveIntegrityCommandClient } from "../../storage/archiveCommandClient";
import type { Book } from "../../types/book";
import {
  createStorage,
  readyState,
  renderLibraryPage,
  selectionBook,
  setupLibraryPageTestSuite,
  waitForButtonWithLabel,
  waitForButtonWithText,
} from "./LibraryPage.testUtils";

function largeBooks(count = 500): Book[] {
  return Array.from({ length: count }, (_, index) =>
    selectionBook(`book-${index}`, `Book ${String(index).padStart(3, "0")}`),
  );
}

function seriesBooks(): Book[] {
  return [
    {
      ...selectionBook("volume-1", "The Beginning"),
      progressPercent: 100,
      sourceMetadata: { series: "Star Saga", volume: "1" },
    },
    {
      ...selectionBook("volume-2", "The Crossing"),
      lastOpenedAt: "2026-07-05T00:00:00.000Z",
      progressPercent: 45,
      sourceMetadata: { series: "Star Saga", volume: "2" },
    },
    {
      ...selectionBook("volume-3", "The Return"),
      sourceMetadata: { series: "Star Saga", volume: "3" },
    },
  ];
}

async function flushRestoration(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  });
}

async function waitForSelector<T extends Element>(
  container: HTMLElement,
  selector: string,
): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const element = container.querySelector<T>(selector);
    if (element) return element;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
  throw new Error(`Element ${selector} was not rendered.`);
}

describe.each(["grid", "list"] as const)("%s reader-return restoration", (view) => {
  const suite = setupLibraryPageTestSuite();

  beforeEach(async () => {
    const preferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...preferences.library,
        collections: {
          ...preferences.library.collections,
          books: { ...preferences.library.collections.books, viewMode: view },
        },
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const element = this as HTMLElement;
      const scrollRoot = element.closest<HTMLElement>(".page-shell");
      const height = element.matches("[data-reader-book-id]")
        ? view === "grid"
          ? 300
          : 75
        : element.classList.contains("page-shell")
          ? 600
          : 0;
      const top = element.matches(".book-grid, .book-list") ? -(scrollRoot?.scrollTop ?? 0) : 0;
      return {
        bottom: top + height,
        height,
        left: 0,
        right: 1_000,
        top,
        width: 1_000,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("page-shell") ? 600 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1_000);
  });

  it("mounts and focuses a returned book outside the initial retained range", async () => {
    const books = largeBooks();
    const target = books[300]!;
    const savedScrollTop = view === "grid" ? 15_000 : 22_500;
    const session = await renderLibraryPage(createStorage({ books }), {
      pathname: "/",
      state: {
        libraryRestoreContext: {
          archiveId: readyState.archive.id,
          focusBookId: target.id,
          href: "/",
          scrollTop: savedScrollTop,
        },
      },
    });
    suite.trackRoot(session.root);

    await flushRestoration();

    const pageShell = session.container.querySelector<HTMLElement>(".page-shell")!;
    const targetBook = session.container.querySelector<HTMLElement>(
      `[data-reader-book-id="${target.id}"]`,
    );
    const targetButton = targetBook?.querySelector<HTMLButtonElement>("button");
    expect(pageShell.scrollTop).toBe(savedScrollTop);
    expect(targetBook).not.toBeNull();
    expect(document.activeElement).toBe(targetButton);
    expect(document.activeElement).not.toBe(pageShell);
    expect(session.container.querySelectorAll("[data-reader-book-id]").length).toBeLessThan(80);

    const search = session.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    )!;
    search.focus();
    await act(async () => {
      pageShell.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    });
    expect(document.activeElement).toBe(search);
  });

  it("falls back once when the returned book is no longer in the result set", async () => {
    const books = largeBooks();
    const session = await renderLibraryPage(createStorage({ books }), {
      pathname: "/",
      state: {
        libraryRestoreContext: {
          archiveId: readyState.archive.id,
          focusBookId: "missing-book",
          href: "/",
          scrollTop: 4_000,
        },
      },
    });
    suite.trackRoot(session.root);
    await flushRestoration();

    const pageShell = session.container.querySelector<HTMLElement>(".page-shell")!;
    expect(pageShell.scrollTop).toBe(4_000);
    expect(document.activeElement).toBe(pageShell);

    const search = session.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    )!;
    search.focus();
    await flushRestoration();
    expect(document.activeElement).toBe(search);
  });

  it("falls back when the returned book is removed by the restored search", async () => {
    const books = largeBooks();
    const session = await renderLibraryPage(createStorage({ books }), {
      pathname: "/",
      state: {
        libraryRestoreContext: {
          archiveId: readyState.archive.id,
          focusBookId: books[300]!.id,
          href: "/",
          query: "Book 001",
          scrollTop: 900,
        },
      },
    });
    suite.trackRoot(session.root);
    await flushRestoration();

    const pageShell = session.container.querySelector<HTMLElement>(".page-shell")!;
    expect(session.container.querySelector(`[data-reader-book-id="${books[300]!.id}"]`)).toBeNull();
    expect(pageShell.scrollTop).toBe(900);
    expect(document.activeElement).toBe(pageShell);
  });
});

describe.each(["grid", "list"] as const)("small %s reader-return restoration", (view) => {
  const suite = setupLibraryPageTestSuite();

  beforeEach(async () => {
    const preferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...preferences.library,
        collections: {
          ...preferences.library.collections,
          books: { ...preferences.library.collections.books, viewMode: view },
        },
      },
    });
  });

  it("preserves the existing non-windowed focus behavior", async () => {
    const books = largeBooks(10);
    const target = books[8]!;
    const session = await renderLibraryPage(createStorage({ books }), {
      pathname: "/",
      state: {
        libraryRestoreContext: {
          archiveId: readyState.archive.id,
          focusBookId: target.id,
          href: "/",
          scrollTop: 120,
        },
      },
    });
    suite.trackRoot(session.root);
    await flushRestoration();

    expect(session.container.querySelector("[data-windowed='true']")).toBeNull();
    expect(document.activeElement).toBe(
      session.container.querySelector(`[data-reader-book-id="${target.id}"] button`),
    );
  });
});

describe("mounted reader-return surfaces", () => {
  const suite = setupLibraryPageTestSuite();

  beforeEach(async () => {
    await appPreferencesStore.update({ showContinueReading: true });
  });

  it("prefers an already-mounted Continue Reading control over its windowed grid book", async () => {
    const books = largeBooks();
    books[300] = {
      ...books[300]!,
      lastOpenedAt: "2026-07-05T00:00:00.000Z",
      progressPercent: 45,
    };
    const target = books[300]!;
    const session = await renderLibraryPage(createStorage({ books }), {
      pathname: "/",
      state: {
        libraryRestoreContext: {
          archiveId: readyState.archive.id,
          focusBookId: target.id,
          href: "/",
          scrollTop: 0,
        },
      },
    });
    suite.trackRoot(session.root);
    await flushRestoration();

    const continueButton = session.container.querySelector<HTMLButtonElement>(
      `.continue-book[data-reader-book-id="${target.id}"]`,
    );
    const pageShell = session.container.querySelector<HTMLElement>(".page-shell")!;
    expect(document.activeElement).toBe(continueButton);
    expect(pageShell.scrollTop).toBe(0);
    expect(
      session.container.querySelector(`.book-grid [data-reader-book-id="${target.id}"]`),
    ).toBeNull();

    const search = session.container.querySelector<HTMLInputElement>(
      'input[name="archeion-library-search"]',
    )!;
    search.focus();
    await flushRestoration();
    expect(document.activeElement).toBe(search);
  });

  it("restores the originating series after returning from Series Detail", async () => {
    const books = [
      ...seriesBooks(),
      {
        ...selectionBook("moon-1", "Moonrise"),
        sourceMetadata: { series: "Moon Tales", volume: "1" },
      },
    ];
    const session = await renderLibraryPage(createStorage({ books }), {
      pathname: "/",
      search: "?view=series",
    });
    suite.trackRoot(session.root);

    const origin = await waitForButtonWithLabel(session.container, "Open Star Saga");
    origin.focus();
    act(() => origin.click());

    const back = await waitForButtonWithText(session.container, "All series");
    expect(document.activeElement).toBe(session.container.querySelector(".page-shell"));
    act(() => back.click());

    const restored = await waitForButtonWithLabel(session.container, "Open Star Saga");
    expect(restored).not.toBe(origin);
    expect(document.activeElement).toBe(restored);
  });

  it("falls back safely for an obsolete Series Overview reader target", async () => {
    const books = seriesBooks();
    const session = await renderLibraryPage(createStorage({ books }), {
      pathname: "/",
      search: "?view=series",
      state: {
        libraryRestoreContext: {
          archiveId: readyState.archive.id,
          focusBookId: "volume-2",
          href: "/?view=series",
          scrollTop: 360,
        },
      },
    });
    suite.trackRoot(session.root);
    await waitForButtonWithLabel(session.container, "Open Star Saga");
    await flushRestoration();

    const pageShell = session.container.querySelector<HTMLElement>(".page-shell")!;
    expect(document.activeElement).toBe(pageShell);
    expect(pageShell.scrollTop).toBe(360);
    expect(session.container.querySelector(".book-grid, .book-list")).toBeNull();
  });

  it.each([
    ["duplicates", "Duplicates", "requestDuplicateAnalysis"],
    ["epub-issues", "EPUB Issues", "requestDiagnostics"],
  ] as const)(
    "restores the originating %s integrity location for a current archive book",
    async (view, title, requestMethod) => {
      const target = {
        ...selectionBook("integrity-book", "Integrity Book"),
        modifiedAt: "2026-08-01T00:00:00.000Z",
        size: 128,
      };
      if (requestMethod === "requestDuplicateAnalysis") {
        vi.spyOn(archiveIntegrityCommandClient, requestMethod).mockImplementation(
          async (request) => ({
            archiveGeneration: request.archiveGeneration,
            groups: [],
            requestRevision: request.requestRevision,
            signatures: {},
          }),
        );
      } else {
        vi.spyOn(archiveIntegrityCommandClient, requestMethod).mockImplementation(
          async (request) => ({
            archiveGeneration: request.archiveGeneration,
            entries: [],
            requestRevision: request.requestRevision,
          }),
        );
      }
      const href = `/?archiveId=${readyState.archive.id}&view=${view}`;
      const session = await renderLibraryPage(createStorage({ books: [target] }), {
        pathname: "/",
        search: `?archiveId=${readyState.archive.id}&view=${view}`,
        state: {
          libraryRestoreContext: {
            archiveId: readyState.archive.id,
            focusBookId: target.id,
            href,
            scrollTop: 180,
          },
        },
      });
      suite.trackRoot(session.root);
      await vi.waitFor(() =>
        expect(archiveIntegrityCommandClient[requestMethod]).toHaveBeenCalled(),
      );
      await flushRestoration();

      const pageShell = session.container.querySelector<HTMLElement>(".page-shell")!;
      expect(session.container.querySelector("main h1")?.textContent).toBe(title);
      expect(pageShell.scrollTop).toBe(180);
      expect(document.activeElement).toBe(pageShell);
      expect(session.container.querySelector(".book-grid, .book-list")).toBeNull();
    },
  );

  it("restores a normal Series Detail volume action", async () => {
    const session = await renderLibraryPage(createStorage({ books: seriesBooks() }), {
      pathname: "/",
      search: "?view=series&seriesKey=star%20saga",
      state: {
        libraryRestoreContext: {
          archiveId: readyState.archive.id,
          focusBookId: "volume-3",
          href: "/?view=series&seriesKey=star%20saga",
          scrollTop: 720,
        },
      },
    });
    suite.trackRoot(session.root);
    await waitForButtonWithLabel(session.container, "Read The Return");
    await flushRestoration();

    const volumeAction = session.container.querySelector<HTMLButtonElement>(
      '[data-reader-book-id="volume-3"] button',
    );
    const pageShell = session.container.querySelector<HTMLElement>(".page-shell")!;
    expect(document.activeElement).toBe(volumeAction);
    expect(pageShell.scrollTop).toBe(720);
    expect(session.container.querySelector(".book-grid, .book-list")).toBeNull();
  });

  it("restores the Series Detail Continue Series action before the matching volume row", async () => {
    const session = await renderLibraryPage(createStorage({ books: seriesBooks() }), {
      pathname: "/",
      search: "?view=series&seriesKey=star%20saga",
      state: {
        libraryRestoreContext: {
          archiveId: readyState.archive.id,
          focusBookId: "volume-2",
          href: "/?view=series&seriesKey=star%20saga",
          scrollTop: 480,
        },
      },
    });
    suite.trackRoot(session.root);
    const continueSeries = await waitForButtonWithText(session.container, "Continue Series");
    await flushRestoration();

    expect(document.activeElement).toBe(continueSeries);
    expect(session.container.querySelector<HTMLElement>(".page-shell")?.scrollTop).toBe(480);
    expect(session.container.querySelector(".book-grid, .book-list")).toBeNull();
  });

  it("falls back after a missing series redirects to Series Overview", async () => {
    const session = await renderLibraryPage(createStorage({ books: seriesBooks() }), {
      pathname: "/",
      search: "?view=series&seriesKey=missing-series",
      state: {
        libraryRestoreContext: {
          archiveId: readyState.archive.id,
          focusBookId: "missing-volume",
          href: "/?view=series&seriesKey=missing-series",
          scrollTop: 240,
        },
      },
    });
    suite.trackRoot(session.root);
    const seriesTitle = await waitForSelector<HTMLElement>(
      session.container,
      "#series-overview-title",
    );
    await flushRestoration();

    const pageShell = session.container.querySelector<HTMLElement>(".page-shell")!;
    expect(seriesTitle.textContent).toBe("Series");
    expect(pageShell.scrollTop).toBe(240);
    expect(document.activeElement).toBe(pageShell);
  });
});
