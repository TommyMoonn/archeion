// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import {
  buttonWithText,
  clickBook,
  createBooksLoadController,
  createStorage,
  renderLibraryPage,
  selectionBook,
  setupLibraryPageTestSuite,
  waitForButtonWithLabel,
  waitForButtonWithText,
} from "./LibraryPage.testUtils";

function installDockMedia() {
  let wide = true;
  const original = window.matchMedia.bind(window);
  const query = original("(min-width: 75rem)");
  Object.defineProperty(query, "matches", { configurable: true, get: () => wide });
  vi.spyOn(window, "matchMedia").mockImplementation((value) =>
    value === query.media ? query : original(value),
  );
  return (value: boolean) => {
    wide = value;
    query.dispatchEvent(new Event("change"));
  };
}

async function pinBook(container: HTMLElement) {
  await act(async () => {
    await import("./BookDetailsDrawer");
    clickBook(container, "Alpha");
  });
  const pin = await waitForButtonWithLabel(container, "Pin book details");
  await act(async () => pin.click());
  await waitForButtonWithLabel(container, "Unpin book details");
  await waitForButtonWithText(container, "Read book");
}

describe("optional pinned Library details", () => {
  const suite = setupLibraryPageTestSuite();

  it("defaults to a slide-over, then browses details without changing bulk selection", async () => {
    installDockMedia();
    const session = await renderLibraryPage(
      createStorage({ books: [selectionBook("a", "Alpha"), selectionBook("b", "Beta")] }),
    );
    suite.trackRoot(session.root);
    expect(session.container.querySelector(".book-details-panel")).toBeNull();
    await pinBook(session.container);
    expect(session.container.querySelector("dialog.details-drawer")).toBeNull();
    expect(session.container.querySelector(".book-details-panel header")).toBeNull();
    expect(session.container.querySelector(".book-details-panel h2")?.textContent).toBe("Alpha");
    act(() => clickBook(session.container, "Beta"));
    expect(session.container.querySelector(".book-details-panel h2")?.textContent).toBe("Beta");
    expect(
      session.container.querySelector('[data-reader-book-id="b"]')?.getAttribute("data-inspected"),
    ).toBe("true");
    expect(session.container.querySelectorAll("[data-selected]")).toHaveLength(0);
    act(() => session.container.querySelector<HTMLInputElement>('input[type="search"]')?.focus());
    expect(session.container.querySelector(".book-details-panel h2")?.textContent).toBe("Beta");
    expect(
      session.container.querySelector('.book-details-panel [aria-label="Close book details"]'),
    ).toBeNull();
    const unpin = await waitForButtonWithLabel(session.container, "Unpin book details");
    await act(async () => unpin.click());
    const close = await waitForButtonWithLabel(session.container, "Close book details");
    await act(async () => {
      close.click();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
    expect(session.container.querySelector(".book-details-panel")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("View details for Beta");
    act(() => clickBook(session.container, "Alpha"));
    expect(session.container.querySelector("dialog.details-drawer")).not.toBeNull();
  });

  it("unpins the current book into the original drawer", async () => {
    installDockMedia();
    const session = await renderLibraryPage(
      createStorage({ books: [selectionBook("a", "Alpha")] }),
    );
    suite.trackRoot(session.root);
    await pinBook(session.container);
    await act(async () =>
      session.container
        .querySelector<HTMLButtonElement>('[aria-label="Unpin book details"]')
        ?.click(),
    );
    expect(session.container.querySelector(".book-details-panel")).toBeNull();
    expect(session.container.querySelector("dialog.details-drawer h2")?.textContent).toBe("Alpha");
  });

  it("keeps the panel and unpin control when its book disappears, including an empty archive", async () => {
    installDockMedia();
    const load = createBooksLoadController();
    load.publishBooks([selectionBook("a", "Alpha"), selectionBook("b", "Beta")]);
    const session = await renderLibraryPage(createStorage(load));
    suite.trackRoot(session.root);
    await pinBook(session.container);
    const panel = session.container.querySelector(".book-details-panel");
    act(() => load.publishBooks([selectionBook("b", "Beta")]));
    expect(panel?.querySelector("h2")?.textContent).toBe("Book details");
    expect(panel?.textContent).toContain(
      "Select a book to see its description, reading progress, and metadata.",
    );
    expect(panel?.querySelector('[aria-label="Unpin book details"]')).not.toBeNull();
    act(() => load.publishBooks([]));
    expect(session.container.querySelector(".book-details-panel")).toBe(panel);
    expect(panel?.textContent).toContain(
      "Book details appear here after you add and select a book.",
    );
  });

  it("shows the bulk selection summary and the single selected book", async () => {
    installDockMedia();
    const session = await renderLibraryPage(
      createStorage({ books: [selectionBook("a", "Alpha"), selectionBook("b", "Beta")] }),
    );
    suite.trackRoot(session.root);
    await pinBook(session.container);
    act(() => clickBook(session.container, "Beta", { ctrlKey: true }));
    expect(session.container.querySelector(".book-details-panel h2")?.textContent).toBe("Beta");
    act(() => clickBook(session.container, "Alpha"));
    expect(session.container.querySelector(".book-details-panel h2")?.textContent).toBe(
      "2 books selected",
    );
    act(() => buttonWithText(session.container, "Clear").click());
    expect(session.container.querySelector(".book-details-panel h2")?.textContent).toBe(
      "Book details",
    );
  });

  it("restores a last-read suggestion without inspecting or selecting it, then resumes it", async () => {
    installDockMedia();
    await appPreferencesStore.update({ showContinueReading: true });
    await appPreferencesStore.updateLibrary({ detailsPinned: true });
    const books = [
      {
        ...selectionBook("older", "Older"),
        lastOpenedAt: "2026-07-01T00:00:00Z",
        progressPercent: 30,
      },
      {
        ...selectionBook("resume", "Resume me"),
        lastOpenedAt: "2026-07-02T00:00:00Z",
        progressCfi: "saved-position",
      },
      {
        ...selectionBook("missing", "Missing"),
        lastOpenedAt: "2026-07-03T00:00:00Z",
        progressPercent: 40,
        isFileMissing: true,
      },
      {
        ...selectionBook("done", "Finished"),
        lastOpenedAt: "2026-07-04T00:00:00Z",
        progressPercent: 100,
      },
      { ...selectionBook("invalid", "Invalid date"), lastOpenedAt: "invalid", progressPercent: 40 },
    ];
    const onRoute = vi.fn();
    const session = await renderLibraryPage(
      createStorage({ books }),
      "/",
      undefined,
      undefined,
      onRoute,
    );
    suite.trackRoot(session.root);
    const panel = session.container.querySelector(".book-details-panel");
    expect(panel?.querySelector("h2")?.textContent).toBe("Resume me");
    expect(panel?.textContent).toContain("Last read");
    expect(panel?.textContent).not.toContain("% read");
    expect(
      session.container.querySelectorAll('[data-inspected="true"], [data-selected]'),
    ).toHaveLength(0);
    expect(panel?.querySelector('[aria-label="Favorite book"]')?.hasAttribute("disabled")).toBe(
      true,
    );
    const resume = await waitForButtonWithText(session.container, "Continue reading");
    await act(async () => resume.click());
    expect(onRoute.mock.lastCall?.[0].pathname).toBe("/reader/resume");
  });

  it("updates the suggestion from snapshots and lets explicit inspection and bulk selection take precedence", async () => {
    installDockMedia();
    await appPreferencesStore.update({ showContinueReading: true });
    await appPreferencesStore.updateLibrary({ detailsPinned: true });
    const older = {
      ...selectionBook("a", "Alpha"),
      lastOpenedAt: "2026-07-01T00:00:00Z",
      progressPercent: 25,
    };
    const recent = {
      ...selectionBook("b", "Beta"),
      lastOpenedAt: "2026-07-02T00:00:00Z",
      progressPercent: 42,
    };
    const load = createBooksLoadController();
    load.publishBooks([older, recent]);
    const session = await renderLibraryPage(createStorage(load));
    suite.trackRoot(session.root);
    const panel = session.container.querySelector(".book-details-panel");
    expect(panel?.querySelector("h2")?.textContent).toBe("Beta");
    expect(panel?.textContent).toContain("42% read");
    act(() => load.publishBooks([older]));
    expect(panel?.querySelector("h2")?.textContent).toBe("Alpha");
    act(() => load.publishBooks([older, recent]));
    await act(async () => {
      await import("./BookDetailsDrawer");
      clickBook(session.container, "Alpha");
    });
    expect(panel?.textContent).not.toContain("Last read");
    expect(panel?.querySelector("h2")?.textContent).toBe("Alpha");
    act(() => clickBook(session.container, "Beta", { ctrlKey: true }));
    act(() => clickBook(session.container, "Alpha"));
    expect(panel?.querySelector("h2")?.textContent).toBe("2 books selected");
    expect(panel?.textContent).not.toContain("Last read");
    act(() => buttonWithText(session.container, "Clear").click());
    expect(panel?.textContent).toContain("Last read");
    act(() => load.publishBooks([]));
    expect(panel?.querySelector("h2")?.textContent).toBe("Book details");
  });

  it("keeps the pinned preview independent of the collection's Continue Reading preference", async () => {
    installDockMedia();
    await appPreferencesStore.update({ showContinueReading: false });
    await appPreferencesStore.updateLibrary({ detailsPinned: true });
    const session = await renderLibraryPage(
      createStorage({
        books: [
          {
            ...selectionBook("a", "Alpha"),
            lastOpenedAt: "2026-07-01T00:00:00Z",
            progressPercent: 25,
          },
        ],
      }),
    );
    suite.trackRoot(session.root);
    const panel = session.container.querySelector(".book-details-panel");
    expect(panel?.querySelector("h2")?.textContent).toBe("Alpha");
    expect(panel?.textContent).toContain("Last read");
    expect(session.container.querySelector(".continue-reading")).toBeNull();
    await act(async () => appPreferencesStore.update({ showContinueReading: true }));
    expect(panel?.textContent).toContain("Last read");
    expect(session.container.querySelector(".continue-reading")).not.toBeNull();
    await act(async () => appPreferencesStore.update({ showContinueReading: false }));
    expect(panel?.textContent).toContain("Last read");
    expect(session.container.querySelector(".continue-reading")).toBeNull();
  });

  it("shows a bounded reading list and opens full details explicitly", async () => {
    installDockMedia();
    await appPreferencesStore.update({ showContinueReading: false });
    await appPreferencesStore.updateLibrary({ detailsPinned: true });
    const books = Array.from({ length: 6 }, (_, index) => ({
      ...selectionBook(`book-${index}`, `Book ${index}`),
      lastOpenedAt: `2026-07-0${index + 1}T00:00:00Z`,
      progressCfi: "saved-position",
      sourceMetadata: { creator: "An author", description: "A book description." },
    }));
    const onRoute = vi.fn();
    const session = await renderLibraryPage(
      createStorage({ books }),
      "/",
      undefined,
      undefined,
      onRoute,
    );
    suite.trackRoot(session.root);
    const panel = session.container.querySelector(".book-details-panel");
    expect(panel?.querySelector("h2")?.textContent).toBe("Book 5");
    expect(panel?.textContent).toContain("A book description.");
    expect(panel?.textContent).toContain("Last opened");
    expect(panel?.textContent).toContain("An author");
    const rows = panel?.querySelectorAll<HTMLButtonElement>(".continue-book");
    expect(rows?.length).toBe(3);
    expect(rows?.[0]?.textContent).toContain("Book 4");
    expect(rows?.[2]?.textContent).toContain("Book 2");
    expect(panel?.querySelector(".continue-book__progress")).toBeNull();
    const details = await waitForButtonWithText(session.container, "View book details");
    await act(async () => {
      await import("./BookDetailsDrawer");
      details.click();
    });
    expect(panel?.textContent).not.toContain("Last read");
    expect(panel?.textContent).not.toContain("Also in progress");
    expect(panel?.querySelector("h2")?.textContent).toBe("Book 5");
    expect(
      session.container
        .querySelector('[data-reader-book-id="book-5"]')
        ?.getAttribute("data-inspected"),
    ).toBe("true");
    expect(onRoute.mock.lastCall?.[0].pathname).toBe("/");
  });

  it("falls back to the drawer on narrow windows and restores the pinned book on widening", async () => {
    const resize = installDockMedia();
    const session = await renderLibraryPage(
      createStorage({ books: [selectionBook("a", "Alpha")] }),
    );
    suite.trackRoot(session.root);
    await pinBook(session.container);
    act(() => resize(false));
    expect(session.container.querySelector(".book-details-panel")).toBeNull();
    expect(session.container.querySelector("dialog.details-drawer h2")?.textContent).toBe("Alpha");
    act(() => resize(true));
    expect(session.container.querySelector("dialog.details-drawer")).toBeNull();
    expect(session.container.querySelector(".book-details-panel h2")?.textContent).toBe("Alpha");
  });

  it("returns from metadata editing to the pinned panel and its original action", async () => {
    installDockMedia();
    await import("./BookAdvancedMetadataDialog");
    const session = await renderLibraryPage(
      createStorage({ books: [selectionBook("a", "Alpha")] }),
    );
    suite.trackRoot(session.root);
    await pinBook(session.container);
    const edit = await waitForButtonWithText(session.container, "Edit metadata");
    act(() => {
      edit.focus();
      edit.click();
    });
    await waitForButtonWithText(session.container, "Write metadata to EPUB");
    await act(async () => {
      session.container
        .querySelector(".dialog--metadata-writeback")
        ?.dispatchEvent(new Event("cancel", { cancelable: true }));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
    expect(session.container.querySelector("dialog.details-drawer")).toBeNull();
    expect(session.container.querySelector(".book-details-panel h2")?.textContent).toBe("Alpha");
    expect(document.activeElement).toBe(edit);
  });
});
