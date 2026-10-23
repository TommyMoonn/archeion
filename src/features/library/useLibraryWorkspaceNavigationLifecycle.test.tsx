// @vitest-environment happy-dom

import { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReaderReturnContext } from "../../app/readerReturnContext";
import type { Book } from "../../types/book";
import type { LibraryLocation } from "../../types/library";
import {
  useLibraryWorkspaceNavigationLifecycle,
  type LibraryReturnRestoration,
} from "./useLibraryWorkspaceNavigation";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const restoreContext: ReaderReturnContext = {
  archiveId: "archive-books",
  focusBookId: "target-book",
  href: "/",
  scrollTop: 900,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latestRestoration: LibraryReturnRestoration | null = null;

function book(id: string): Book {
  return {
    addedAt: "1",
    fileName: `${id}.epub`,
    id,
    isFavorite: false,
    originalTitle: id,
    updatedAt: "1",
  };
}

function Harness({
  books,
  location = { type: "library" },
  mountedBookId,
  booksReady = true,
  onCommit,
}: {
  books: readonly Book[];
  location?: LibraryLocation;
  mountedBookId?: string;
  booksReady?: boolean;
  onCommit?: (restoration: LibraryReturnRestoration) => void;
}) {
  const pageShellRef = useRef<HTMLElement>(null);
  const restoredRef = useRef(false);
  const restoration = useLibraryWorkspaceNavigationLifecycle({
    activeSeriesExists: true,
    booksReady,
    changeLocation: vi.fn(),
    location,
    pageShellRef,
    restoreContext,
    returnContextRestoredRef: restoredRef,
    visibleBooks: books,
  });
  useLayoutEffect(() => {
    latestRestoration = restoration;
    onCommit?.(restoration);
  }, [onCommit, restoration]);

  return (
    <main className="page-shell" ref={pageShellRef} tabIndex={-1}>
      <button type="button">Other focus</button>
      {mountedBookId ? (
        <article
          data-reader-book-id={mountedBookId}
          data-library-index={books.findIndex((book) => book.id === mountedBookId)}
        >
          <button type="button">Mounted target</button>
        </article>
      ) : null}
    </main>
  );
}

async function renderHarness(props: React.ComponentProps<typeof Harness>): Promise<void> {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(<Harness {...props} />));
}

async function flushRestoration(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    await Promise.resolve();
  });
}

function appendCollectionTarget(index: number): HTMLButtonElement {
  const pageShell = container?.querySelector<HTMLElement>(".page-shell");
  if (!pageShell) throw new Error("Page shell was not rendered.");
  const bookTarget = document.createElement("article");
  bookTarget.dataset.libraryIndex = String(index);
  bookTarget.dataset.readerBookId = "target-book";
  const button = document.createElement("button");
  bookTarget.append(button);
  pageShell.append(bookTarget);
  return button;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  latestRestoration = null;
  vi.restoreAllMocks();
});

describe("windowed reader-return request stability", () => {
  it("provides the return request in the first ready commit without waiting for a frame", async () => {
    const commits: LibraryReturnRestoration[] = [];
    await renderHarness({ books: [book("target-book")], onCommit: (value) => commits.push(value) });
    expect(commits[0]?.collectionRequest?.bookId).toBe("target-book");
  });

  it("starts with delayed data only when ready and respects earlier direct input", async () => {
    const books = [book("target-book")];
    await renderHarness({ books, booksReady: false });
    expect(latestRestoration?.collectionRequest).toBeNull();
    await act(async () => document.dispatchEvent(new Event("wheel")));
    await renderHarness({ books, booksReady: true });
    await flushRestoration();
    expect(latestRestoration?.collectionRequest).toBeNull();
  });
  it("derives a moved target index from its stable book ID", async () => {
    const initialBooks = Array.from({ length: 500 }, (_, index) =>
      book(index === 300 ? "target-book" : `book-${index}`),
    );
    await renderHarness({ books: initialBooks });
    await flushRestoration();
    const oldRequest = latestRestoration?.collectionRequest;
    expect(oldRequest?.index).toBe(300);

    const movedBooks = [
      book("target-book"),
      ...initialBooks.filter((item) => item.id !== "target-book"),
    ];
    await renderHarness({ books: movedBooks });
    expect(latestRestoration?.collectionRequest?.index).toBe(0);

    const staleTarget = document.createElement("button");
    act(() => oldRequest?.onTargetReady("target-book", 300, staleTarget));
    expect(document.activeElement).not.toBe(staleTarget);

    const currentTarget = appendCollectionTarget(0);
    act(() => latestRestoration?.collectionRequest?.onTargetReady("target-book", 0, currentTarget));
    expect(document.activeElement).toBe(currentTarget);
  });

  it("falls back exactly once when a pending target leaves the result set", async () => {
    const initialBooks = [book("first"), book("target-book"), book("last")];
    await renderHarness({ books: initialBooks });
    await flushRestoration();
    const pageShell = container?.querySelector<HTMLElement>(".page-shell");
    if (!pageShell) throw new Error("Page shell was not rendered.");
    const focus = vi.spyOn(pageShell, "focus");

    await renderHarness({ books: initialBooks.filter((item) => item.id !== "target-book") });
    await act(async () => Promise.resolve());
    expect(document.activeElement).toBe(pageShell);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(latestRestoration?.collectionRequest).toBeNull();

    await renderHarness({ books: initialBooks });
    await act(async () => Promise.resolve());
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("waits for the collection geometry owner before focusing a newly mounted target", async () => {
    const books = [book("first"), book("target-book"), book("last")];
    await renderHarness({ books });
    await flushRestoration();
    const staleRequest = latestRestoration?.collectionRequest;

    await renderHarness({ books, mountedBookId: "target-book" });
    await act(async () => Promise.resolve());
    const mountedTarget = Array.from(container?.querySelectorAll("button") ?? []).find(
      (buttonElement) => buttonElement.textContent === "Mounted target",
    );
    expect(document.activeElement).not.toBe(mountedTarget);

    const currentTarget = appendCollectionTarget(1);
    act(() => latestRestoration?.collectionRequest?.onTargetReady("target-book", 1, currentTarget));
    expect(document.activeElement).toBe(mountedTarget);

    const staleTarget = document.createElement("button");
    container?.append(staleTarget);
    act(() => staleRequest?.onTargetReady("target-book", 1, staleTarget));
    expect(document.activeElement).toBe(mountedTarget);
  });

  it.each(["wheel", "pointerdown", "keydown", "touchstart"])(
    "retires pending scroll and focus after %s intent",
    async (type) => {
      await renderHarness({ books: [book("target-book")] });
      await flushRestoration();
      const stale = latestRestoration?.collectionRequest;
      await act(async () => document.dispatchEvent(new Event(type, { bubbles: true })));
      const target = appendCollectionTarget(0);
      act(() => stale?.onTargetReady("target-book", 0, target));
      expect(document.activeElement).not.toBe(target);
      expect(latestRestoration?.collectionRequest).toBeNull();
    },
  );

  it("cancels even before the initial return frame", async () => {
    await renderHarness({ books: [book("target-book")] });
    await act(async () => document.dispatchEvent(new Event("wheel")));
    await flushRestoration();
    expect(latestRestoration?.collectionRequest).toBeNull();
    expect(container?.querySelector("main")?.scrollTop).toBe(0);
  });

  it("retires an old return when the collection identity changes", async () => {
    const books = [book("target-book")];
    await renderHarness({ books });
    await flushRestoration();
    const stale = latestRestoration?.collectionRequest;
    await renderHarness({ books, location: { type: "folder", folderId: "different-folder" } });
    const target = appendCollectionTarget(0);
    act(() => stale?.onTargetReady("target-book", 0, target));
    expect(document.activeElement).not.toBe(target);
    expect(latestRestoration?.collectionRequest).toBeNull();
  });

  it("completes without stealing focus when the user moves focus while retention is pending", async () => {
    const books = [book("first"), book("target-book"), book("last")];
    await renderHarness({ books });
    await flushRestoration();
    const otherFocus = Array.from(container?.querySelectorAll("button") ?? []).find(
      (buttonElement) => buttonElement.textContent === "Other focus",
    )!;
    otherFocus.focus();

    const target = appendCollectionTarget(1);
    act(() => latestRestoration?.collectionRequest?.onTargetReady("target-book", 1, target));
    expect(document.activeElement).toBe(otherFocus);
    expect(latestRestoration?.collectionRequest).toBeNull();
  });
});
