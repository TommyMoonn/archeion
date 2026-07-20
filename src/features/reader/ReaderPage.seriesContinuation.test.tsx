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

const viewerMock = vi.hoisted(() => ({
  onError: undefined as ((message: string) => void) | undefined,
  sessionsStarted: 0,
  location: {
    atEnd: false,
    atStart: false,
    cfi: "epubcfi(/6/10)",
    percentage: 0,
  },
}));

const fileOwnerMock = vi.hoisted(() => ({
  release: vi.fn(),
}));

vi.mock("./EpubViewer", async () => {
  const React = await import("react");

  return {
    EpubViewer: React.forwardRef(function MockEpubViewer(
      {
        onError,
        onLocationChange,
        onReady,
      }: {
        onError: (message: string) => void;
        onLocationChange: (location: typeof viewerMock.location) => void;
        onReady: () => void;
      },
      ref: React.ForwardedRef<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({
        navigateToChapter: vi.fn().mockResolvedValue(false),
        navigateToLocation: vi.fn().mockResolvedValue(true),
        next: vi.fn().mockResolvedValue(undefined),
        previous: vi.fn().mockResolvedValue(undefined),
      }));
      React.useEffect(() => {
        viewerMock.sessionsStarted += 1;
        viewerMock.onError = onError;
        onLocationChange(viewerMock.location);
        onReady();
        return () => {
          if (viewerMock.onError === onError) viewerMock.onError = undefined;
        };
      }, [onError, onLocationChange, onReady]);

      return <div data-testid="epub-viewer" />;
    }),
  };
});

vi.mock("./useReaderFileLoad", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("./useReaderFileLoad")>();
  return {
    ...actual,
    useReaderFileLoad(options: Parameters<typeof actual.useReaderFileLoad>[0]) {
      const { release: releaseOwnedFile, result } = actual.useReaderFileLoad(options);
      const release = React.useCallback(() => {
        fileOwnerMock.release();
        releaseOwnedFile();
      }, [releaseOwnedFile]);
      return { release, result };
    },
  };
});

vi.mock("../archive/useArchive", () => ({
  useArchive: () => ({ status: "ready", archive: { id: "archive-1" } }),
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
  fileOwnerMock.release.mockClear();
});

describe("ReaderPage series continuation", () => {
  it("keeps a missing EPUB out of the viewer and offers library recovery", async () => {
    const rendered = await renderReader(
      [createBook({ id: "missing-book", isFileMissing: true })],
      "missing-book",
    );

    expect(rendered.container.textContent).toContain("Book file missing");
    expect(rendered.container.textContent).toContain("Rescan library");
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
    expect(rendered.container.textContent).toContain("Unable to open book");
    expect(rendered.container.textContent).toContain("Unreadable EPUB");
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeNull();
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
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeNull();
  });

  it("replaces the active viewer with a concise EPUB parsing failure", async () => {
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

    act(() => reportError?.("The EPUB package is invalid."));

    const alert = rendered.container.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("Unable to open book");
    expect(alert?.textContent).toContain("The EPUB package is invalid.");
    expect(fileOwnerMock.release).toHaveBeenCalledTimes(1);
    expect(rendered.container.querySelector('[data-testid="epub-viewer"]')).toBeNull();
    await act(async () => Promise.resolve());
    expect(loadBookFile).toHaveBeenCalledTimes(1);
  });

  it("uses the library root when Escape has no valid return context", async () => {
    const rendered = await renderReader([createBook({ id: "book" })], "book");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(rendered.router.state.location.pathname).toBe("/");
    expect(rendered.router.state.location.state).toBeNull();
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

  it("does not remount the EPUB viewer when the TOC opens or closes", async () => {
    viewerMock.sessionsStarted = 0;
    viewerMock.location = {
      atEnd: false,
      atStart: false,
      cfi: "epubcfi(/6/10)",
      percentage: 20,
    };
    const rendered = await renderReader([createBook({ id: "book" })], "book");
    const tocButton = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Table of contents"]',
    );

    expect(tocButton).toBeInstanceOf(HTMLButtonElement);
    expect(viewerMock.sessionsStarted).toBe(1);

    await act(async () => {
      tocButton?.click();
      await Promise.resolve();
    });
    expect(rendered.container.querySelector(".reader-toc")).toBeInstanceOf(HTMLElement);
    expect(viewerMock.sessionsStarted).toBe(1);

    await act(async () => {
      tocButton?.click();
    });
    expect(rendered.container.querySelector(".reader-toc")).toBeNull();
    expect(viewerMock.sessionsStarted).toBe(1);
  });

  it("offers the next volume only after completion and opens it on user action", async () => {
    viewerMock.location = {
      atEnd: true,
      atStart: false,
      cfi: "epubcfi(/6/12)",
      percentage: 99.5,
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
      percentage: 99.4,
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
