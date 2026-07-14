// @vitest-environment happy-dom

import { act, useLayoutEffect, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, BookmarkAnnotation } from "../../types/annotation";
import { useReaderAnnotationCollection } from "./useReaderAnnotationCollection";

type CollectionApi = ReturnType<typeof useReaderAnnotationCollection>;

function bookmark(id: string): BookmarkAnnotation {
  return {
    cfiRange: `epubcfi(/6/${id.length})`,
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    type: "bookmark",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function Harness({
  activeArchiveId,
  apiRef,
  bookId,
  storage,
}: {
  activeArchiveId: string;
  apiRef: MutableRefObject<CollectionApi | undefined>;
  bookId?: string;
  storage: LibraryStorage;
}) {
  const collection = useReaderAnnotationCollection({
    activeArchiveId,
    bookId,
    storage,
  });
  useLayoutEffect(() => {
    apiRef.current = collection;
  }, [apiRef, collection]);
  return <span>{collection.annotations.map(({ id }) => id).join(",")}</span>;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(
  storage: LibraryStorage,
  bookId: string | undefined,
  apiRef: MutableRefObject<CollectionApi | undefined>,
  activeArchiveId = "archive-a",
) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(
      <Harness
        activeArchiveId={activeArchiveId}
        apiRef={apiRef}
        bookId={bookId}
        storage={storage}
      />,
    );
    await Promise.resolve();
  });
  await act(async () => Promise.resolve());
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useReaderAnnotationCollection", () => {
  it("hides archive A immediately and rejects its callbacks when the same book opens in archive B", async () => {
    const archiveBLoad = deferred<Annotation[]>();
    const storage = {
      listAnnotations: vi
        .fn()
        .mockResolvedValueOnce([bookmark("archive-a")])
        .mockReturnValueOnce(archiveBLoad.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<CollectionApi | undefined> = { current: undefined };
    const rendered = await render(storage, "shared-book", apiRef, "archive-a");
    const staleSync = apiRef.current?.sync;
    const staleForget = apiRef.current?.forget;
    expect(rendered.textContent).toBe("archive-a");

    await render(storage, "shared-book", apiRef, "archive-b");
    expect(rendered.textContent).toBe("");
    expect(apiRef.current?.loadStatus).toBe("loading");
    act(() => {
      staleSync?.(bookmark("stale-write"));
      staleForget?.("archive-a");
    });
    expect(rendered.textContent).toBe("");

    await act(async () => archiveBLoad.resolve([bookmark("archive-b")]));
    expect(rendered.textContent).toBe("archive-b");
  });

  it("loads one authoritative collection and updates it through sync and forget", async () => {
    const storage = {
      listAnnotations: vi.fn(async () => [bookmark("first")]),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<CollectionApi | undefined> = { current: undefined };
    const rendered = await render(storage, "book-a", apiRef);

    expect(rendered.textContent).toBe("first");
    expect(apiRef.current?.loadStatus).toBe("ready");
    act(() => apiRef.current?.sync(bookmark("second")));
    expect(rendered.textContent).toBe("first,second");
    act(() => apiRef.current?.forget("first"));
    expect(rendered.textContent).toBe("second");
  });

  it("loads an empty collection without storage access when no book is active", async () => {
    const storage = { listAnnotations: vi.fn() } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<CollectionApi | undefined> = { current: undefined };
    const rendered = await render(storage, undefined, apiRef);

    expect(rendered.textContent).toBe("");
    expect(apiRef.current?.loadStatus).toBe("ready");
    expect(storage.listAnnotations).not.toHaveBeenCalled();
  });

  it("owns load failure, dismissal, retry success, and retry failure", async () => {
    const storage = {
      listAnnotations: vi
        .fn()
        .mockRejectedValueOnce(new Error("first failure"))
        .mockRejectedValueOnce(new Error("retry failure"))
        .mockResolvedValueOnce([bookmark("recovered")]),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<CollectionApi | undefined> = { current: undefined };
    const rendered = await render(storage, "book-a", apiRef);

    expect(apiRef.current?.loadFailed).toBe(true);
    act(() => apiRef.current?.clearLoadError());
    expect(apiRef.current?.loadFailed).toBe(false);
    await act(async () => expect(apiRef.current?.reload()).resolves.toBe(false));
    expect(apiRef.current?.loadFailed).toBe(true);
    await act(async () => expect(apiRef.current?.reload()).resolves.toBe(true));
    expect(rendered.textContent).toBe("recovered");
    expect(apiRef.current?.loadFailed).toBe(false);
  });

  it("lets the newest overlapping reload own the active collection", async () => {
    const first = deferred<Annotation[]>();
    const second = deferred<Annotation[]>();
    const storage = {
      listAnnotations: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<CollectionApi | undefined> = { current: undefined };
    const rendered = await render(storage, "book-a", apiRef);

    let reload!: Promise<boolean>;
    act(() => {
      reload = apiRef.current!.reload();
    });
    await act(async () => second.resolve([bookmark("newest")]));
    await expect(reload).resolves.toBe(true);
    await act(async () => first.resolve([bookmark("stale")]));
    expect(rendered.textContent).toBe("newest");
  });

  it("rejects a stale load after switching books", async () => {
    const firstLoad = deferred<Annotation[]>();
    const storage = {
      listAnnotations: vi
        .fn()
        .mockImplementationOnce(() => firstLoad.promise)
        .mockResolvedValueOnce([bookmark("book-b")]),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<CollectionApi | undefined> = { current: undefined };
    const rendered = await render(storage, "book-a", apiRef);
    await render(storage, "book-b", apiRef);

    expect(rendered.textContent).toBe("book-b");
    await act(async () => firstLoad.resolve([bookmark("stale-a")]));
    expect(rendered.textContent).toBe("book-b");
  });

  it("uses a fresh session token when switching away and back to the same book ID", async () => {
    const firstA = bookmark("first-a");
    const bookB = bookmark("book-b");
    const secondA = bookmark("second-a");
    const storage = {
      listAnnotations: vi
        .fn()
        .mockResolvedValueOnce([firstA])
        .mockResolvedValueOnce([bookB])
        .mockResolvedValueOnce([secondA]),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<CollectionApi | undefined> = { current: undefined };
    const rendered = await render(storage, "book-a", apiRef);
    const staleApi = apiRef.current;

    await render(storage, "book-b", apiRef);
    await render(storage, "book-a", apiRef);
    act(() => {
      staleApi?.sync(bookmark("stale-sync"));
      staleApi?.forget(secondA.id);
    });

    expect(rendered.textContent).toBe(secondA.id);
    expect(staleApi?.session.token).not.toBe(apiRef.current?.session.token);
  });

  it("rejects stale sync and forget callbacks after a book-session change", async () => {
    const storage = {
      listAnnotations: vi.fn(async (bookId: string) => [bookmark(`${bookId}-annotation`)]),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<CollectionApi | undefined> = { current: undefined };
    const rendered = await render(storage, "book-a", apiRef);
    const staleApi = apiRef.current;
    await render(storage, "book-b", apiRef);

    act(() => {
      staleApi?.sync(bookmark("stale"));
      staleApi?.forget("book-b-annotation");
    });
    expect(rendered.textContent).toBe("book-b-annotation");
  });

  it("ignores load settlement after unmount", async () => {
    const pending = deferred<Annotation[]>();
    const storage = { listAnnotations: vi.fn(() => pending.promise) } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<CollectionApi | undefined> = { current: undefined };
    await render(storage, "book-a", apiRef);
    const staleApi = apiRef.current;

    act(() => root?.unmount());
    root = null;
    await act(async () => pending.resolve([bookmark("late")]));
    expect(staleApi?.isCurrentSession(staleApi.session)).toBe(false);
  });
});
