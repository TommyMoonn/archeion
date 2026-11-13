// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it } from "vitest";

import { installBrowserContextMenuPolicy } from "../../app/browserContextMenuPolicy";
import {
  contextMenuItemWithText,
  createStorage,
  renderLibraryPage,
  selectionBook,
  setupLibraryPageTestSuite,
} from "./LibraryPage.testUtils";

describe("Library background context menu", () => {
  const suite = setupLibraryPageTestSuite();

  it("opens the existing Add EPUB workflow from blank Library content", async () => {
    await import("../filesystem/AddEpubDialog");
    const session = await renderLibraryPage(
      createStorage({ books: [selectionBook("alpha", "Alpha")] }),
    );
    suite.trackRoot(session.root);

    const collection = session.container.querySelector<HTMLElement>(".library-content--books");
    expect(collection).not.toBeNull();

    const stopPolicy = installBrowserContextMenuPolicy(document);
    try {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 90,
      });
      await act(async () => {
        collection?.dispatchEvent(event);
        await Promise.resolve();
      });

      expect(event.defaultPrevented).toBe(true);
      const menu = document.body.querySelector<HTMLElement>(
        '[role="menu"][aria-label="Library actions"]',
      );
      if (!menu) throw new Error("Library background context menu was not rendered.");
      expect(menu.textContent).toContain("Add EPUB");

      await act(async () => {
        contextMenuItemWithText(menu, "Add EPUB").click();
        await Promise.resolve();
      });

      expect(session.container.textContent).toContain("Add EPUB files");
      expect(session.container.querySelector(".dialog--add-epub")).not.toBeNull();
    } finally {
      stopPolicy();
    }
  });

  it("keeps book-card context menus as the only menu for book targets", async () => {
    const session = await renderLibraryPage(
      createStorage({ books: [selectionBook("alpha", "Alpha")] }),
    );
    suite.trackRoot(session.root);

    const card = session.container.querySelector<HTMLElement>('[data-reader-book-id="alpha"]');
    expect(card).not.toBeNull();

    await act(async () => {
      card?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 90,
        }),
      );
    });

    const menus = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"]'));
    expect(menus).toHaveLength(1);
    expect(menus[0]?.getAttribute("aria-label")).toBe("Actions for Alpha");
    expect(menus[0]?.textContent).not.toContain("Add EPUB");
  });
});
