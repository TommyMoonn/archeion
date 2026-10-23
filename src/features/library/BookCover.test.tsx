// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import type { Book } from "../../types/book";
import { BookCover } from "./BookCover";
import { CoverUrlCacheScopeContext } from "./coverUrlCacheScope";
import { COVER_RETENTION, retireCoverUrlScope } from "./coverUrlCache";
import { decodeCoverImage } from "./decodeCoverImage";

vi.mock("./decodeCoverImage", () => ({
  decodeCoverImage: vi.fn(async () => ({
    naturalWidth: 120,
    naturalHeight: 180,
    removeAttribute: vi.fn(),
  })),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type IntersectionObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0];

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

  const defaultScope = `test-${book.id}`;

  function render(nextBook: Book, cacheScope = defaultScope) {
    act(() => {
      root.render(
        <LibraryStorageContext.Provider value={storage as never}>
          <CoverUrlCacheScopeContext value={cacheScope}>
            <BookCover book={nextBook} />
          </CoverUrlCacheScopeContext>
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
    [
      "book-cover-1",
      "book-cover-windowed",
      "book-cover-2",
      "book-cover-3",
      "book-cover-shared",
      "delayed",
      "failed",
      "stale",
    ].forEach((id) => retireCoverUrlScope(`test-${id}`));
    retireCoverUrlScope("archive-b");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the placeholder after URL acquisition until decode succeeds", async () => {
    let finish!: (image: HTMLImageElement) => void;
    vi.mocked(decodeCoverImage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = renderCover(
      { ...baseBook, id: "delayed" },
      vi.fn().mockResolvedValue(new Blob(["cover"])),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".book-cover--placeholder")).not.toBeNull();
    await act(async () => {
      finish({
        naturalWidth: 120,
        naturalHeight: 180,
        removeAttribute: vi.fn(),
      } as unknown as HTMLImageElement);
    });
    expect(container.querySelector(".book-cover")?.getAttribute("data-cover-state")).toBe(
      "available",
    );
  });

  it("defers unrelated offscreen covers until the visibility observer admits them", async () => {
    vi.spyOn(ImmediateIntersectionObserver.prototype, "observe").mockImplementation(
      () => undefined,
    );
    const load = vi.fn().mockResolvedValue(new Blob(["cover"]));
    const { container } = renderCover({ ...baseBook, id: "delayed" }, load);
    await act(async () => {
      await Promise.resolve();
    });
    expect(load).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
  });

  it("remounts a recently decoded book without replaying its placeholder", async () => {
    const load = vi.fn().mockResolvedValue(new Blob(["cover"]));
    const book = { ...baseBook, id: "delayed" };
    const { container, render } = renderCover(book, load);
    await waitForCover(container);
    act(() => activeRoot?.render(null));
    render(book);
    expect(container.querySelector(".book-cover")?.getAttribute("data-cover-state")).toBe(
      "available",
    );
    await waitForCover(container);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retires pending work outside the margin and safely retries on viewport reentry", async () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      margin?: string;
      target?: Element;
    }> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private readonly observation: (typeof observers)[number];
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          this.observation = { callback, margin: options?.rootMargin };
          observers.push(this.observation);
        }
        observe(target: Element) {
          this.observation.target = target;
        }
        unobserve() {}
        disconnect() {}
      },
    );
    let finish!: (value: Blob) => void;
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Blob>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(new Blob(["new"]));
    const { container } = renderCover({ ...baseBook, id: "stale" }, load);
    const near = observers.find((observer) => Boolean(observer.margin))!;
    const visible = observers.find((observer) => !observer.margin)!;
    const emit = async (observer: typeof near, isIntersecting: boolean) => {
      await act(async () =>
        observer.callback(
          [
            {
              target: observer.target!,
              isIntersecting,
              boundingClientRect: container.getBoundingClientRect(),
              intersectionRect: container.getBoundingClientRect(),
              intersectionRatio: isIntersecting ? 1 : 0,
              rootBounds: null,
              time: 0,
            },
          ],
          {} as IntersectionObserver,
        ),
      );
    };
    await emit(near, true);
    await emit(visible, true);
    expect(load).toHaveBeenCalledTimes(1);
    await emit(visible, false);
    await emit(near, false);
    await act(async () => finish(new Blob(["retired"])));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(container.querySelector(".book-cover")?.getAttribute("data-cover-state")).toBe(
      "loading",
    );
    await emit(near, true);
    await emit(visible, true);
    await waitForCover(container);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shows stable fallback on invalid pixels and retries on a new revision", async () => {
    vi.mocked(decodeCoverImage).mockRejectedValueOnce(new Error("Invalid bytes"));
    const { container, render } = renderCover(
      { ...baseBook, id: "failed" },
      vi.fn().mockResolvedValue(new Blob(["invalid"])),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector(".book-cover")?.getAttribute("data-cover-state")).toBe(
      "unavailable",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cover");
    render({ ...baseBook, id: "failed", coverRevision: "retry" });
    await waitForCover(container);
  });

  it("ignores a stale decode after revision replacement and retirement", async () => {
    let finish!: (image: HTMLImageElement) => void;
    vi.mocked(decodeCoverImage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:old").mockReturnValueOnce("blob:new");
    const { container, render } = renderCover(
      { ...baseBook, id: "stale" },
      vi.fn().mockResolvedValue(new Blob(["cover"])),
    );
    await act(async () => {
      await Promise.resolve();
    });
    render({ ...baseBook, id: "stale", coverRevision: "new" });
    await waitForCover(container);
    await act(async () => {
      finish({
        naturalWidth: 120,
        naturalHeight: 180,
        removeAttribute: vi.fn(),
      } as unknown as HTMLImageElement);
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:new");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old");
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

  it("uses one visibility policy for retained covers", async () => {
    const observe = vi.spyOn(ImmediateIntersectionObserver.prototype, "observe");
    const loadBookCover = vi.fn().mockResolvedValue(new Blob(["cover"]));
    const { container } = renderCover({ ...baseBook, id: "book-cover-windowed" }, loadBookCover);

    await waitForCover(container);

    expect(observe).toHaveBeenCalledTimes(2);
    expect(loadBookCover).toHaveBeenCalledTimes(1);
  });

  it("reloads when coverRevision changes", async () => {
    const loadBookCover = vi.fn().mockResolvedValue(new Blob(["cover"]));
    const { container, render } = renderCover({ ...baseBook, id: "book-cover-2" }, loadBookCover);
    await waitForCover(container);

    render({
      ...baseBook,
      id: "book-cover-2",
      coverRevision: "cover:changed",
    });
    await waitForCover(container);

    expect(loadBookCover).toHaveBeenCalledTimes(2);
  });

  it("releases the previous cover object URL when the cover key changes", async () => {
    vi.useFakeTimers();
    try {
      const createObjectUrl = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValueOnce("blob:first-cover")
        .mockReturnValueOnce("blob:second-cover");
      const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      const loadBookCover = vi.fn().mockResolvedValue(new Blob(["cover"]));
      const { container, render } = renderCover(
        { ...baseBook, id: "book-cover-3", coverRevision: "cover:first" },
        loadBookCover,
      );
      await waitForCover(container);

      render({
        ...baseBook,
        id: "book-cover-3",
        coverRevision: "cover:second",
      });
      await waitForCover(container);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(COVER_RETENTION.milliseconds);
      });

      expect(loadBookCover).toHaveBeenCalledTimes(2);
      expect(createObjectUrl).toHaveBeenCalledTimes(2);
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first-cover");
      expect(revokeObjectUrl).not.toHaveBeenCalledWith("blob:second-cover");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reloads the same book key when the active archive scope changes", async () => {
    const loadBookCover = vi.fn().mockResolvedValue(new Blob(["cover"]));
    const { container, render } = renderCover(
      { ...baseBook, id: "book-cover-shared" },
      loadBookCover,
    );
    await waitForCover(container);

    render({ ...baseBook, id: "book-cover-shared" }, "archive-b");
    await waitForCover(container);

    expect(loadBookCover).toHaveBeenCalledTimes(2);
  });
});
