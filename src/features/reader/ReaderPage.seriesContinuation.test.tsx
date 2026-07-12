// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import type { Book } from "../../types/book";
import { ReaderRoute } from "./ReaderPage";

const viewerMock = vi.hoisted(() => ({
  sessionsStarted: 0,
  location: {
    atEnd: false,
    atStart: false,
    cfi: "epubcfi(/6/10)",
    percentage: 0,
  },
}));

vi.mock("./EpubViewer", async () => {
  const React = await import("react");

  return {
    EpubViewer: React.forwardRef(function MockEpubViewer(
      {
        onLocationChange,
        onReady,
      }: {
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
        onLocationChange(viewerMock.location);
        onReady();
      }, [onLocationChange, onReady]);

      return <div data-testid="epub-viewer" />;
    }),
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

function createStorage(books: Book[]): LibraryStorage {
  return {
    loadBookFile: vi.fn().mockResolvedValue(new Blob(["epub"])),
    listAnnotations: vi.fn().mockResolvedValue([]),
    createAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    listBooks: vi.fn().mockResolvedValue(books),
    updateBook: vi.fn().mockImplementation(async (id, changes) => {
      const book = books.find((candidate) => candidate.id === id);
      return book ? { ...book, ...changes } : undefined;
    }),
  } as unknown as LibraryStorage;
}

async function renderReader(
  books: Book[],
  initialBookId: string,
  readerReturnContext?: Record<string, unknown>,
) {
  const storage = createStorage(books);
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
        <RouterProvider router={router} />
      </LibraryStorageContext.Provider>,
    );
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (container.querySelector(".reader-page")) {
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
