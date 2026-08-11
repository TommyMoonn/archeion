// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickActionsProvider } from "../quick-actions/QuickActionsProvider";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import type { Book } from "../../types/book";
import { ReaderRoute } from "./ReaderPage";
import type { ReaderSessionIdentity } from "./readerSession";
import type { EpubSessionError } from "./useEpubSession";

const viewerMock = vi.hoisted(() => ({
  initialCfi: undefined as string | undefined,
  onError: undefined as ((error: EpubSessionError) => void) | undefined,
  sessionIdentities: [] as ReaderSessionIdentity[],
  sessionsStarted: 0,
  teardown: vi.fn(),
  location: {
    atEnd: false,
    atStart: false,
    cfi: "epubcfi(/6/10)",
    rawPercentage: 0,
    sectionCount: 10,
  },
}));

vi.mock("./EpubViewer", async () => {
  const React = await import("react");

  return {
    EpubViewer: React.forwardRef(function MockEpubViewer(
      {
        initialCfi,
        onError,
        onLocationChange,
        onReady,
        sessionIdentity,
      }: {
        initialCfi?: string;
        onError: (identity: ReaderSessionIdentity, error: EpubSessionError) => void;
        onLocationChange: (location: typeof viewerMock.location) => void;
        onReady: (identity: ReaderSessionIdentity) => void;
        sessionIdentity: ReaderSessionIdentity;
      },
      ref: React.ForwardedRef<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({
        navigateToChapter: vi.fn().mockResolvedValue(false),
        navigateToNavigationItem: vi.fn().mockResolvedValue(false),
        navigateToLocation: vi.fn().mockResolvedValue(true),
        next: vi.fn().mockResolvedValue(undefined),
        previous: vi.fn().mockResolvedValue(undefined),
        teardown: viewerMock.teardown,
      }));
      React.useEffect(() => {
        const reportError = (error: EpubSessionError) => onError(sessionIdentity, error);
        viewerMock.sessionsStarted += 1;
        viewerMock.sessionIdentities.push(sessionIdentity);
        viewerMock.initialCfi = initialCfi;
        viewerMock.onError = reportError;
        onLocationChange(viewerMock.location);
        onReady(sessionIdentity);
        return () => {
          if (viewerMock.onError === reportError) viewerMock.onError = undefined;
        };
      }, [initialCfi, onError, onLocationChange, onReady, sessionIdentity]);

      return <div data-testid="epub-viewer" />;
    }),
  };
});

vi.mock("../archive/useArchive", () => ({
  useArchive: () => ({ status: "ready", archive: { id: "archive-1" }, path: "/archive" }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function createBook(overrides: Partial<Book> & Pick<Book, "id">): Book {
  return {
    addedAt: "2026-07-01T00:00:00.000Z",
    fileName: `${overrides.id}.epub`,
    isFavorite: false,
    originalTitle: overrides.id,
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function createStorage(books: Book[], overrides: Partial<LibraryStorage> = {}): LibraryStorage {
  return {
    flushPendingWrites: vi.fn().mockResolvedValue(undefined),
    loadBookFile: vi.fn().mockResolvedValue(new Blob(["epub"])),
    listAnnotations: vi.fn().mockResolvedValue([]),
    createAnnotation: vi.fn(),
    updateBookmarkAnnotation: vi.fn(),
    updateHighlightAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    listBooks: vi.fn().mockResolvedValue(books),
    updateBook: vi.fn().mockImplementation(async (id, changes) => {
      const book = books.find((candidate) => candidate.id === id);
      return book ? { ...book, ...changes } : undefined;
    }),
    ...overrides,
  } as unknown as LibraryStorage;
}

async function renderReader(
  books: Book[],
  initialBookId: string,
  readerReturnContext?: Record<string, unknown>,
  storageOverrides?: Partial<LibraryStorage>,
) {
  viewerMock.teardown.mockReset();
  viewerMock.sessionIdentities.length = 0;
  const storage = createStorage(books, storageOverrides);
  const router = createMemoryRouter(
    [
      {
        HydrateFallback: () => null,
        path: "/reader/:bookId",
        element: <ReaderRoute />,
        loader: ({ params }) => books.find((book) => book.id === params.bookId),
      },
      { path: "/", element: <div data-testid="library-origin" /> },
    ],
    {
      initialEntries: [
        {
          pathname: `/reader/${initialBookId}`,
          state: readerReturnContext ? { readerReturnContext } : undefined,
        },
      ],
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LibraryStorageContext.Provider value={storage}>
        <QuickActionsProvider>
          <RouterProvider router={router} />
        </QuickActionsProvider>
      </LibraryStorageContext.Provider>,
    );
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (container.querySelector(".reader-page, .reader-status-page")) {
      break;
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  return { container, router, storage };
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe("ReaderPage series continuation", () => {
  it("keeps a missing EPUB out of the viewer and offers library recovery", async () => {
    const rendered = await renderReader(
      [createBook({ id: "missing-book", isFileMissing: true })],
      "missing-book",
    );

    expect(rendered.container.textContent).toContain("Book file missing");
    expect(rendered.container.textContent).toContain("Rescan Library");
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeNull();
    expect(rendered.storage.loadBookFile).not.toHaveBeenCalled();
  });

  it("reports an unreadable EPUB before mounting the viewer", async () => {
    const loadBookFile = vi.fn().mockRejectedValue(new Error("Unreadable EPUB"));
    const rendered = await renderReader(
      [createBook({ id: "unreadable-book" })],
      "unreadable-book",
      undefined,
      { loadBookFile },
    );

    expect(loadBookFile).toHaveBeenCalledWith("unreadable-book");
    expect(rendered.container.textContent).toContain("EPUB could not be opened");
    expect(rendered.container.textContent).toContain(
      "The EPUB file could not be read. It may have been moved or deleted. Rescan the Library to update it.",
    );
    expect(rendered.container.textContent).not.toContain("Unreadable EPUB");
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeNull();
  });

  it("retries a failed source load through the rendered Reader", async () => {
    const loadBookFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unreadable EPUB"))
      .mockResolvedValueOnce(new Blob(["epub"]));
    const rendered = await renderReader(
      [createBook({ id: "retry-book" })],
      "retry-book",
      undefined,
      { loadBookFile },
    );
    const retry = [...rendered.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );

    expect(retry).toBeInstanceOf(HTMLButtonElement);
    await act(async () => retry?.click());

    expect(loadBookFile).toHaveBeenCalledTimes(2);
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeInstanceOf(
      HTMLElement,
    );
  });

  it("surfaces the native EPUB size boundary before mounting the viewer", async () => {
    const loadBookFile = vi
      .fn()
      .mockRejectedValue(new Error("This EPUB exceeds Archeion's 256 MiB reader limit."));
    const rendered = await renderReader(
      [createBook({ id: "oversized-book" })],
      "oversized-book",
      undefined,
      { loadBookFile },
    );

    expect(rendered.container.textContent).toContain(
      "This EPUB exceeds Archeion's 256 MiB reader limit.",
    );
    expect(
      [...rendered.container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Try again",
      ),
    ).toBe(false);
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeNull();
  });

  it("retries an EPUB session failure with a fresh identity and ignores the retired callback", async () => {
    const loadBookFile = vi.fn().mockResolvedValue(new Blob(["invalid epub"]));
    const rendered = await renderReader(
      [createBook({ id: "invalid-book" })],
      "invalid-book",
      undefined,
      { loadBookFile },
    );
    const reportError = viewerMock.onError;
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeInstanceOf(
      HTMLElement,
    );
    expect(reportError).toBeTypeOf("function");

    act(() => reportError?.({ kind: "open-failed" }));

    const alert = rendered.container.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("EPUB could not be opened");
    expect(alert?.textContent).toContain(
      "This EPUB could not be opened. Try again or return to the Library.",
    );
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeNull();
    const retry = [...rendered.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );
    expect(retry).toBeInstanceOf(HTMLButtonElement);

    await act(async () => retry?.click());
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeInstanceOf(
      HTMLElement,
    );
    expect(viewerMock.sessionIdentities).toHaveLength(2);
    expect(viewerMock.sessionIdentities[1]).not.toBe(viewerMock.sessionIdentities[0]);

    act(() => reportError?.({ kind: "open-failed" }));
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeInstanceOf(
      HTMLElement,
    );
    expect(loadBookFile).toHaveBeenCalledTimes(1);
  });

  it("uses the library root when Escape has no valid return context", async () => {
    const rendered = await renderReader([createBook({ id: "book" })], "book");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(rendered.router.state.location.pathname).toBe("/");
    expect(rendered.router.state.location.state).toBeNull();
    expect(rendered.storage.flushPendingWrites).toHaveBeenCalled();
  });

  it("returns to the explicit origin from the toolbar", async () => {
    const returnContext = {
      archiveId: "archive-1",
      focusBookId: "book",
      href: "/?view=favorites",
      label: "Favorites",
      query: "favorite query",
      scrollTop: 240,
    };
    const rendered = await renderReader([createBook({ id: "book" })], "book", returnContext);
    const back = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to Favorites"]',
    );

    expect(back?.textContent).toContain("Back");
    await act(async () => back?.click());

    expect(rendered.router.state.location.pathname).toBe("/");
    expect(rendered.router.state.location.search).toBe("?view=favorites");
    expect(rendered.router.state.location.state).toEqual({
      libraryRestoreContext: returnContext,
    });
  });

  it("does not remount the EPUB viewer when book navigation opens or closes", async () => {
    viewerMock.sessionsStarted = 0;
    viewerMock.location = {
      atEnd: false,
      atStart: false,
      cfi: "epubcfi(/6/10)",
      rawPercentage: 0.2,
      sectionCount: 10,
    };
    const rendered = await renderReader([createBook({ id: "book" })], "book");
    const tocButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Book navigation"]',
    );

    expect(tocButton).toBeInstanceOf(HTMLButtonElement);
    expect(viewerMock.sessionsStarted).toBe(1);

    await act(async () => {
      tocButton?.click();
      await Promise.resolve();
    });
    expect(rendered.container.querySelector(".reader-navigation")).toBeInstanceOf(HTMLElement);
    expect(viewerMock.sessionsStarted).toBe(1);

    await act(async () => {
      tocButton?.click();
    });
    expect(rendered.container.querySelector(".reader-navigation")).toBeNull();
    expect(viewerMock.sessionsStarted).toBe(1);
  });

  it("passes controller-restored progress into the EPUB session", async () => {
    await renderReader(
      [
        createBook({
          id: "restored-book",
          progressCfi: "epubcfi(/6/18)",
          progressPercent: 64,
        }),
      ],
      "restored-book",
    );

    expect(viewerMock.initialCfi).toBe("epubcfi(/6/18)");
  });

  it("offers the next volume only after completion and opens it on user action", async () => {
    viewerMock.location = {
      atEnd: true,
      atStart: false,
      cfi: "epubcfi(/6/12)",
      rawPercentage: 0.995,
      sectionCount: 10,
    };
    const books = [
      createBook({
        id: "volume-1",
        originalTitle: "First Volume",
        progressCfi: "epubcfi(/6/8)",
        progressPercent: 80,
        sourceMetadata: { series: "Star Saga", volume: "1" },
      }),
      createBook({
        id: "volume-2",
        originalTitle: "Second Volume",
        sourceMetadata: { series: "Star Saga", volume: "2" },
      }),
    ];
    const returnContext = {
      archiveId: "archive-1",
      href: "/?view=series&series=Star+Saga",
      label: "Star Saga",
    };
    const rendered = await renderReader(books, "volume-1", returnContext);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (rendered.container.textContent?.includes("Open next volume")) {
        break;
      }
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }

    expect(rendered.router.state.location.pathname).toBe("/reader/volume-1");
    expect(rendered.container.textContent).toContain("Second Volume");

    const openButton = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Open next volume",
    );
    expect(openButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      openButton?.click();
      await Promise.resolve();
    });

    expect(rendered.router.state.location.pathname).toBe("/reader/volume-2");
    expect(rendered.router.state.location.state).toEqual({ readerReturnContext: returnContext });
  });

  it("does not offer the next volume before the completion threshold", async () => {
    viewerMock.location = {
      atEnd: false,
      atStart: false,
      cfi: "epubcfi(/6/10)",
      rawPercentage: 0.994,
      sectionCount: 10,
    };
    const books = [
      createBook({
        id: "volume-1",
        progressCfi: "epubcfi(/6/12)",
        progressPercent: 100,
        sourceMetadata: { series: "Star Saga", volume: "1" },
      }),
      createBook({
        id: "volume-2",
        sourceMetadata: { series: "Star Saga", volume: "2" },
      }),
    ];
    const rendered = await renderReader(books, "volume-1");

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(rendered.container.textContent).not.toContain("Open next volume");
    expect(rendered.storage.listBooks).not.toHaveBeenCalled();
    expect(rendered.router.state.location.pathname).toBe("/reader/volume-1");
  });
});
