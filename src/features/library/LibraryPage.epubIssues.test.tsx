// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { readerReturnContextFromState } from "../../app/readerReturnContext";
import { archiveIntegrityCommandClient } from "../../storage/archiveCommandClient";
import type { Book } from "../../types/book";
import type { EpubDiagnosticAnalysisResult } from "../../types/epubIntegrity";
import "./LibraryEpubIssuesView";
import {
  createStorage,
  renderLibraryPage,
  setupLibraryPageTestSuite,
  waitForButtonWithText,
} from "./LibraryPage.testUtils";

const suite = setupLibraryPageTestSuite();
const modifiedAt = Date.parse("2026-08-13T00:00:00.000Z");

const affectedBook: Book = {
  addedAt: "2026-01-01T00:00:00.000Z",
  fileName: "Affected.epub",
  id: "affected",
  isFavorite: false,
  modifiedAt: new Date(modifiedAt).toISOString(),
  originalTitle: "Affected EPUB",
  relativePath: "Shelf/Affected.epub",
  size: 128,
  sourceMetadata: { creator: "Ada", title: "Affected EPUB" },
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function result(
  requestRevision: number,
  code:
    | "broken-local-document-target"
    | "navigation-resource-unusable" = "broken-local-document-target",
): EpubDiagnosticAnalysisResult {
  return {
    archiveGeneration: 1,
    entries: [
      {
        diagnostics: {
          formatVersion: 1,
          issues: [
            {
              code,
              messageInputs: { href: "missing.xhtml" },
              resourcePath: "OPS/chapter.xhtml",
              severity: "warning",
            },
          ],
        },
        relativePath: affectedBook.relativePath!,
        signature: { modifiedAtMillis: modifiedAt, sizeBytes: affectedBook.size! },
        source: "computed",
      },
    ],
    requestRevision,
  };
}

describe("LibraryPage EPUB Issues integration", () => {
  it("routes issue actions to existing Library and Reader owners", async () => {
    vi.spyOn(archiveIntegrityCommandClient, "requestDiagnostics").mockImplementation(
      async (request) => result(request.requestRevision),
    );
    let readerRoute: Readonly<{ pathname: string; state: unknown }> | undefined;
    const href = "/?archiveId=archive-books&view=epub-issues";
    const storage = createStorage({ books: [affectedBook] });
    const session = await renderLibraryPage(storage, href, undefined, undefined, (route) => {
      if (route.pathname.startsWith("/reader/")) readerRoute = route;
    });
    suite.trackRoot(session.root);

    await act(async () => (await waitForButtonWithText(session.container, "Book details")).click());
    await vi.waitFor(() => {
      expect(session.container.querySelector(".details-drawer")?.textContent).toContain(
        "Affected EPUB",
      );
    });
    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('button[aria-label="Close book details"]')
        ?.click();
    });

    await act(async () => (await waitForButtonWithText(session.container, "Reveal")).click());
    expect(storage.revealBookFile).toHaveBeenCalledWith(affectedBook.id);

    await act(async () => (await waitForButtonWithText(session.container, "Read")).click());
    await vi.waitFor(() => expect(readerRoute).toBeDefined());
    expect(readerReturnContextFromState(readerRoute?.state, "archive-books")).toMatchObject({
      href,
      label: "EPUB Issues",
    });
  });

  it("refreshes through the integrity controller and replaces diagnostic details", async () => {
    const request = vi
      .spyOn(archiveIntegrityCommandClient, "requestDiagnostics")
      .mockImplementation(async (input) =>
        request.mock.calls.length === 1
          ? result(input.requestRevision)
          : result(input.requestRevision, "navigation-resource-unusable"),
      );
    const session = await renderLibraryPage(
      createStorage({ books: [affectedBook] }),
      "/?archiveId=archive-books&view=epub-issues",
    );
    suite.trackRoot(session.root);

    await vi.waitFor(() => expect(session.container.textContent).toContain("Affected EPUB"));
    await act(async () => (await waitForButtonWithText(session.container, "Refresh")).click());
    await vi.waitFor(() => {
      expect(
        session.container.querySelector('[data-issue-code="navigation-resource-unusable"]'),
      ).not.toBeNull();
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0].requestRevision).toBeGreaterThan(
      request.mock.calls[0]?.[0].requestRevision ?? 0,
    );
  });

  it("keeps ordinary Library navigation usable after initial diagnostics failure", async () => {
    vi.spyOn(archiveIntegrityCommandClient, "requestDiagnostics").mockRejectedValue(
      new Error("Diagnostics unavailable."),
    );
    const session = await renderLibraryPage(
      createStorage({ books: [affectedBook] }),
      "/?archiveId=archive-books&view=epub-issues",
    );
    suite.trackRoot(session.root);

    await vi.waitFor(() => {
      expect(session.container.textContent).toContain("EPUB Issues unavailable");
    });
    const libraryLink = Array.from(
      session.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Library");
    if (!libraryLink) throw new Error("Library navigation was not rendered.");
    await act(async () => libraryLink.click());

    await vi.waitFor(() => {
      expect(session.container.querySelector(".book-grid, .book-list")).not.toBeNull();
      expect(session.container.textContent).toContain("Affected EPUB");
    });
  });
});
