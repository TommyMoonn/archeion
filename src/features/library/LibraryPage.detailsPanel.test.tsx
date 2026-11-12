// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
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

  it("keeps the panel and header when its book disappears, including an empty archive", async () => {
    installDockMedia();
    const load = createBooksLoadController();
    load.publishBooks([selectionBook("a", "Alpha"), selectionBook("b", "Beta")]);
    const session = await renderLibraryPage(createStorage(load));
    suite.trackRoot(session.root);
    await pinBook(session.container);
    const panel = session.container.querySelector(".book-details-panel");
    act(() => load.publishBooks([selectionBook("b", "Beta")]));
    expect(panel?.textContent).toContain("Select a book");
    expect(panel?.textContent).toContain(
      "View its description, reading progress, and metadata here.",
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
      "Select a book",
    );
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
