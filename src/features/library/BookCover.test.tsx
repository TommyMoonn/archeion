// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import type { Book } from "../../types/book";
import { BookCover } from "./BookCover";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type IntersectionObserverCallback = ConstructorParameters<
  typeof IntersectionObserver
>[0];

class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly scrollMargin = "";
  readonly thresholds = [];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  disconnect(): void {}
  observe(target: Element): void {
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      this,
    );
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve(): void {}
}

const baseBook: Book = {
  id: "book-cover-1",
  fileName: "Volume_01.epub",
  relativePath: "Series/Volume_01.epub",
  originalTitle: "Volume 01",
  isFavorite: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  size: 2048,
  modifiedAt: "2026-01-01T00:00:00.000Z",
  coverRevision: "cover:stable",
};

let activeRoot: Root | null = null;

function renderCover(book: Book, loadBookCover: () => Promise<Blob | undefined>) {
  const container = document.createElement("div");
  const root = createRoot(container);
  activeRoot = root;
  const storage = { loadBookCover };

  function render(nextBook: Book) {
    act(() => {
      root.render(
        <LibraryStorageContext.Provider value={storage as never}>
          <BookCover book={nextBook} />
        </LibraryStorageContext.Provider>,
      );
    });
  }

  render(book);
  return { container, render };
}

async function waitForCover(container: Element) {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector(".book-cover")?.getAttribute("data-cover-state")).toBe(
    "available",
  );
}

describe("BookCover", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cover");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not reset to loading when file stats change but coverRevision is stable", async () => {
    const loadBookCover = vi.fn().mockResolvedValue(new Blob(["cover"]));
    const { container, render } = renderCover(baseBook, loadBookCover);
    await waitForCover(container);

    render({
      ...baseBook,
      size: 4096,
      modifiedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(loadBookCover).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".book-cover")?.getAttribute("data-cover-state")).toBe(
      "available",
    );
  });

  it("reloads when coverRevision changes", async () => {
    const loadBookCover = vi.fn().mockResolvedValue(new Blob(["cover"]));
    const { container, render } = renderCover(
      { ...baseBook, id: "book-cover-2" },
      loadBookCover,
    );
    await waitForCover(container);

    render({
      ...baseBook,
      id: "book-cover-2",
      coverRevision: "cover:changed",
    });
    await waitForCover(container);

    expect(loadBookCover).toHaveBeenCalledTimes(2);
  });
});
