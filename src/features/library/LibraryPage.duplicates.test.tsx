// @vitest-environment happy-dom

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readerReturnContextFromState } from "../../app/readerReturnContext";
import { archiveIntegrityCommandClient } from "../../storage/archiveCommandClient";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import type { LibrarySnapshot, StorageObserver } from "../../storage/LibraryStorage";
import type { Book } from "../../types/book";
import type { EpubDuplicateAnalysisResult } from "../../types/epubIntegrity";
import {
  createStorage,
  contextMenuItemWithText,
  openControlledContextMenu,
  renderLibraryPage,
  setupLibraryPageTestSuite,
  waitForButtonWithLabel,
  waitForButtonWithText,
} from "./LibraryPage.testUtils";

const suite = setupLibraryPageTestSuite();
const modifiedAt = Date.parse("2026-08-02T00:00:00.000Z");

function duplicateBook(id: string, relativePath: string, title: string): Book {
  return {
    addedAt: "2026-01-01T00:00:00.000Z",
    fileName: relativePath.split("/").at(-1) ?? relativePath,
    id,
    isFavorite: false,
    modifiedAt: new Date(modifiedAt).toISOString(),
    originalTitle: title,
    relativePath,
    size: 1024,
    sourceMetadata: { creator: "Ada", identifier: "urn:duplicate", title },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const alpha = duplicateBook("alpha", "One/Alpha.epub", "Alpha");
const alphaCopy = duplicateBook("alpha-copy", "Two/Alpha.epub", "Alpha copy");

function result(
  requestRevision: number,
  kind: "exact" | "probable" = "exact",
): EpubDuplicateAnalysisResult {
  return {
    archiveGeneration: 1,
    groups: [
      {
        identity: kind === "exact" ? "sha256:alpha" : "urn:duplicate",
        kind,
        members: [alpha.relativePath!, alphaCopy.relativePath!],
      },
    ],
    requestRevision,
    signatures: {
      [alpha.relativePath!]: { modifiedAtMillis: modifiedAt, sizeBytes: alpha.size! },
      [alphaCopy.relativePath!]: { modifiedAtMillis: modifiedAt, sizeBytes: alphaCopy.size! },
    },
  };
}

describe("LibraryPage duplicate review integration", () => {
  beforeEach(async () => {
    const preferences = appPreferencesStore.getSnapshot();
    await appPreferencesStore.update({
      library: {
        ...preferences.library,
        smartViews: { enabled: true, visible: ["duplicates"] },
      },
    });
  });

  it("routes member actions to the current Library action owners", async () => {
    vi.spyOn(archiveIntegrityCommandClient, "requestDuplicateAnalysis").mockImplementation(
      async (request) => result(request.requestRevision),
    );
    const storage = createStorage({ books: [alpha, alphaCopy] });
    const session = await renderLibraryPage(storage, "/?archiveId=archive-books&view=duplicates");
    suite.trackRoot(session.root);

    const details = await waitForButtonWithLabel(session.container, "Open details for Alpha");
    await act(async () => details.click());
    const closeDetails = await waitForButtonWithLabel(session.container, "Close book details");
    expect(session.container.querySelector(".details-drawer")?.textContent).toContain("Alpha");
    await act(async () => closeDetails.click());

    const reveal = await waitForButtonWithText(session.container, "Reveal");
    await act(async () => reveal.click());
    expect(storage.revealBookFile).toHaveBeenCalledWith(alpha.id);
  });

  it("labels a duplicate member Reader return from Duplicates despite a retained query", async () => {
    vi.spyOn(archiveIntegrityCommandClient, "requestDuplicateAnalysis").mockImplementation(
      async (request) => result(request.requestRevision),
    );
    let readerRoute: Readonly<{ pathname: string; state: unknown }> | undefined;
    const duplicatesHref = "/?archiveId=archive-books&view=duplicates";
    const session = await renderLibraryPage(
      createStorage({ books: [alpha, alphaCopy] }),
      {
        pathname: "/",
        search: "?archiveId=archive-books&view=duplicates",
        state: {
          libraryRestoreContext: {
            archiveId: "archive-books",
            href: duplicatesHref,
            query: "retained search",
          },
        },
      },
      undefined,
      undefined,
      (route) => {
        if (route.pathname.startsWith("/reader/")) readerRoute = route;
      },
    );
    suite.trackRoot(session.root);

    await act(async () => (await waitForButtonWithText(session.container, "Read")).click());
    await vi.waitFor(() => expect(readerRoute).toBeDefined());

    const returnContext = readerReturnContextFromState(readerRoute?.state, "archive-books");
    expect(returnContext).toMatchObject({
      href: duplicatesHref,
      label: "Duplicates",
      query: "retained search",
    });
  });

  it("refreshes through the integrity controller and publishes the current grouping", async () => {
    const request = vi
      .spyOn(archiveIntegrityCommandClient, "requestDuplicateAnalysis")
      .mockImplementation(async (input) =>
        request.mock.calls.length === 1
          ? result(input.requestRevision, "exact")
          : result(input.requestRevision, "probable"),
      );
    const session = await renderLibraryPage(
      createStorage({ books: [alpha, alphaCopy] }),
      "/?archiveId=archive-books&view=duplicates",
    );
    suite.trackRoot(session.root);

    await vi.waitFor(() => {
      expect(session.container.textContent).toContain("Exact duplicate");
    });
    await act(async () => {
      (await waitForButtonWithText(session.container, "Refresh")).click();
    });
    await vi.waitFor(() => {
      expect(session.container.querySelector('[data-duplicate-kind="probable"]')).not.toBeNull();
      expect(session.container.textContent).toContain("EPUB identifier");
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0].requestRevision).toBeGreaterThan(
      request.mock.calls[0]?.[0].requestRevision ?? 0,
    );
  });

  it("settles deletion through Library mutation ownership and removes the stale group", async () => {
    vi.spyOn(archiveIntegrityCommandClient, "requestDuplicateAnalysis").mockImplementation(
      async (request) => result(request.requestRevision),
    );
    const observers = new Set<StorageObserver<LibrarySnapshot>>();
    let snapshot: LibrarySnapshot = {
      archiveGeneration: 1,
      archiveRootPath: "D:\\Books",
      books: [alpha, alphaCopy],
      folders: [],
      loadState: "ready",
      revision: 1,
      scanStatus: { status: "idle" },
    };
    const deleteBook = vi.fn(async (bookId: string) => {
      snapshot = {
        ...snapshot,
        books: snapshot.books.filter((book) => book.id !== bookId),
        revision: snapshot.revision + 1,
      };
      observers.forEach((observer) => observer.next(snapshot));
      return true;
    });
    const storage = createStorage({
      books: [alpha, alphaCopy],
      deleteBook,
      getLibrarySnapshot: () => snapshot,
      observeLibrarySnapshot: (observer) => {
        observers.add(observer);
        return () => observers.delete(observer);
      },
    });
    const session = await renderLibraryPage(storage, "/?archiveId=archive-books&view=duplicates");
    suite.trackRoot(session.root);

    await waitForButtonWithLabel(session.container, "File actions for Alpha");
    const menu = await openControlledContextMenu(session.container, "File actions for Alpha");
    await act(async () => contextMenuItemWithText(menu, "Delete EPUB").click());
    await act(async () => (await waitForButtonWithText(session.container, "Delete EPUB")).click());

    await vi.waitFor(() => {
      expect(deleteBook).toHaveBeenCalledWith(alpha.id);
      expect(session.container.textContent).toContain("No duplicate groups");
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(session.container.querySelector("main"));
    });
  });

  it("settles an active duplicate view to Library when its Smart View is hidden", async () => {
    vi.spyOn(archiveIntegrityCommandClient, "requestDuplicateAnalysis").mockImplementation(
      async (request) => result(request.requestRevision),
    );
    const session = await renderLibraryPage(
      createStorage({ books: [alpha, alphaCopy] }),
      "/?archiveId=archive-books&view=duplicates",
    );
    suite.trackRoot(session.root);
    await vi.waitFor(() =>
      expect(session.container.querySelector("main h1")?.textContent).toBe("Duplicates"),
    );

    const preferences = appPreferencesStore.getSnapshot();
    await act(async () => {
      await appPreferencesStore.update({
        library: {
          ...preferences.library,
          smartViews: { enabled: true, visible: ["unread"] },
        },
      });
    });

    await vi.waitFor(() => {
      expect(session.container.querySelector("main h1")?.textContent).toBe("Library");
    });
  });
});
