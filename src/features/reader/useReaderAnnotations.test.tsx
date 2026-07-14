// @vitest-environment happy-dom

import { act, useLayoutEffect, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import { useReaderAnnotations } from "./useReaderAnnotations";

type ReaderAnnotationsApi = ReturnType<typeof useReaderAnnotations>;

const location = {
  atEnd: false,
  atStart: false,
  cfi: "epubcfi(/6/2!/4/2:10)",
  percentage: 12.5,
};

function bookmark(id = "bookmark"): BookmarkAnnotation {
  return {
    cfiRange: location.cfi,
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    type: "bookmark",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function highlight(id = "highlight"): HighlightAnnotation {
  return {
    cfiRange: "epubcfi(/6/2!/4/2,/1:2,/1:12)",
    color: "yellow",
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    selectedText: "Saved passage",
    type: "highlight",
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
  apiRef,
  bookId,
  storage,
}: {
  apiRef: MutableRefObject<ReaderAnnotationsApi | undefined>;
  bookId: string;
  storage: LibraryStorage;
}) {
  const annotations = useReaderAnnotations({
    bookId,
    location,
    openingError: false,
    readerReady: true,
    storage,
  });
  useLayoutEffect(() => {
    apiRef.current = annotations;
  }, [annotations, apiRef]);
  return (
    <div>
      <span data-testid="ids">{annotations.annotations.map(({ id }) => id).join(",")}</span>
      <span data-testid="bookmarks">{annotations.bookmarks.map(({ id }) => id).join(",")}</span>
      <span data-testid="feedback">{annotations.feedback?.message}</span>
      <span data-testid="busy">{String(annotations.busy)}</span>
      <button onClick={() => void annotations.toggleCurrent()} type="button">
        Toggle
      </button>
    </div>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderHarness(
  storage: LibraryStorage,
  bookId: string,
  apiRef: MutableRefObject<ReaderAnnotationsApi | undefined>,
) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(<Harness apiRef={apiRef} bookId={bookId} storage={storage} />);
    await Promise.resolve();
  });
  await act(async () => Promise.resolve());
  return container;
}

function text(testId: string) {
  return container?.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

function toggle() {
  const button = container?.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("Toggle button was not rendered.");
  button.click();
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useReaderAnnotations facade", () => {
  it("keeps the public API wired and projects collection synchronization into bookmarks", async () => {
    const storage = {
      listAnnotations: vi.fn(async () => []),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<ReaderAnnotationsApi | undefined> = { current: undefined };
    await renderHarness(storage, "book-a", apiRef);

    expect(apiRef.current).toEqual(
      expect.objectContaining({
        annotations: [],
        bookmarks: [],
        busy: false,
        canToggleCurrent: true,
        loadStatus: "ready",
        clearFeedback: expect.any(Function),
        forget: expect.any(Function),
        queueAnchorUpdate: expect.any(Function),
        reload: expect.any(Function),
        remove: expect.any(Function),
        sync: expect.any(Function),
        toggleCurrent: expect.any(Function),
        undoRemove: expect.any(Function),
        updateAnchor: expect.any(Function),
        updateLabel: expect.any(Function),
      }),
    );
    act(() => apiRef.current?.sync(bookmark("synced")));
    expect(text("ids")).toBe("synced");
    expect(text("bookmarks")).toBe("synced");
    act(() => apiRef.current?.forget("synced"));
    expect(text("ids")).toBe("");
    expect(text("bookmarks")).toBe("");
  });

  it("releases queued anchor maintenance after an interactive mutation settles", async () => {
    const current = bookmark();
    const invalid = highlight();
    const labelWrite = deferred<BookmarkAnnotation | undefined>();
    const storage = {
      listAnnotations: vi.fn(async () => [current, invalid]),
      updateBookmarkAnnotation: vi.fn(() => labelWrite.promise),
      updateHighlightAnnotation: vi.fn(async () => ({ ...invalid, anchorStatus: "detached" })),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<ReaderAnnotationsApi | undefined> = { current: undefined };
    await renderHarness(storage, "book-a", apiRef);

    let labelResult!: Promise<boolean>;
    act(() => {
      labelResult = apiRef.current!.updateLabel(current, "Renamed");
    });
    const maintenance = apiRef.current!.queueAnchorUpdate(
      invalid,
      { anchorStatus: "detached" },
      "invalid",
    );
    expect(storage.updateHighlightAnnotation).not.toHaveBeenCalled();

    await act(async () => labelWrite.resolve({ ...current, label: "Renamed" }));
    await expect(labelResult).resolves.toBe(true);
    await act(async () => expect(maintenance).resolves.toBe(true));
    expect(storage.updateHighlightAnnotation).toHaveBeenCalledOnce();
    expect(apiRef.current?.annotations).toContainEqual(
      expect.objectContaining({ anchorStatus: "detached", id: invalid.id }),
    );
  });

  it("gives an active load failure priority over pending mutation feedback", async () => {
    const load = deferred<Annotation[]>();
    const storage = {
      listAnnotations: vi.fn(() => load.promise),
      createAnnotation: vi.fn(async () => bookmark("created")),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<ReaderAnnotationsApi | undefined> = { current: undefined };
    await renderHarness(storage, "book-a", apiRef);

    await act(async () => toggle());
    expect(text("feedback")).toBe("Bookmark added.");
    await act(async () => load.reject(new Error("load failed")));
    expect(text("feedback")).toBe("Annotations could not be loaded.");

    act(() => apiRef.current?.clearFeedback());
    expect(text("feedback")).toBe("");
  });

  it("does not consume a later load failure when pending mutation feedback is dismissed", async () => {
    const load = deferred<Annotation[]>();
    const storage = {
      listAnnotations: vi.fn(() => load.promise),
      createAnnotation: vi.fn(async () => bookmark("created")),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<ReaderAnnotationsApi | undefined> = { current: undefined };
    await renderHarness(storage, "book-a", apiRef);

    await act(async () => toggle());
    expect(text("feedback")).toBe("Bookmark added.");
    act(() => apiRef.current?.clearFeedback());
    expect(text("feedback")).toBe("");

    await act(async () => load.reject(new Error("load failed")));
    expect(text("feedback")).toBe("Annotations could not be loaded.");
  });

  it("successful load settlement and retry clear previous public feedback", async () => {
    const initialLoad = deferred<Annotation[]>();
    const storage = {
      listAnnotations: vi.fn().mockReturnValueOnce(initialLoad.promise).mockResolvedValueOnce([]),
      createAnnotation: vi.fn(async () => bookmark("created")),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<ReaderAnnotationsApi | undefined> = { current: undefined };
    await renderHarness(storage, "book-a", apiRef);
    await act(async () => toggle());
    expect(text("feedback")).toBe("Bookmark added.");
    await act(async () => initialLoad.reject(new Error("load failed")));
    expect(text("feedback")).toBe("Annotations could not be loaded.");

    await act(async () => expect(apiRef.current?.reload()).resolves.toBe(true));
    expect(text("feedback")).toBe("");
  });

  it("does not let a mutation completing after load failure mask the load error", async () => {
    const load = deferred<Annotation[]>();
    const creation = deferred<BookmarkAnnotation>();
    const storage = {
      listAnnotations: vi.fn(() => load.promise),
      createAnnotation: vi.fn(() => creation.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<ReaderAnnotationsApi | undefined> = { current: undefined };
    await renderHarness(storage, "book-a", apiRef);
    act(() => toggle());
    await act(async () => load.reject(new Error("load failed")));
    expect(text("feedback")).toBe("Annotations could not be loaded.");

    await act(async () => creation.resolve(bookmark("late-created")));
    expect(text("feedback")).toBe("Annotations could not be loaded.");
    act(() => apiRef.current?.clearFeedback());
    expect(text("feedback")).toBe("");
  });

  it("does not reveal feedback from an earlier book session", async () => {
    const bookALoad = deferred<Annotation[]>();
    const creation = deferred<BookmarkAnnotation>();
    const storage = {
      listAnnotations: vi
        .fn()
        .mockReturnValueOnce(bookALoad.promise)
        .mockResolvedValueOnce([bookmark("book-b")]),
      createAnnotation: vi.fn(() => creation.promise),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<ReaderAnnotationsApi | undefined> = { current: undefined };
    await renderHarness(storage, "book-a", apiRef);
    act(() => toggle());
    await renderHarness(storage, "book-b", apiRef);
    await act(async () => bookALoad.reject(new Error("stale load failure")));
    await act(async () => creation.resolve(bookmark("stale mutation")));

    expect(text("ids")).toBe("book-b");
    expect(text("feedback")).toBe("");
    expect(text("busy")).toBe("false");
  });
});
