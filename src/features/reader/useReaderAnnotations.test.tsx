// @vitest-environment happy-dom

import { act, useLayoutEffect, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, BookmarkAnnotation } from "../../types/annotation";
import { useReaderAnnotations } from "./useReaderAnnotations";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const location = {
  atEnd: false,
  atStart: false,
  cfi: "epubcfi(/6/2!/4/2:10)",
  percentage: 12.5,
};

type ReaderAnnotationsApi = ReturnType<typeof useReaderAnnotations>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function bookmark(id = "bookmark-1", label?: string): BookmarkAnnotation {
  return {
    id,
    type: "bookmark",
    cfiRange: location.cfi,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    label,
  };
}

function HookHarness({
  apiRef,
  bookId,
  currentLocation = location,
  openingError = false,
  readerReady = true,
  storage,
}: {
  apiRef?: MutableRefObject<ReaderAnnotationsApi | undefined>;
  bookId: string;
  currentLocation?: typeof location;
  openingError?: boolean;
  readerReady?: boolean;
  storage: LibraryStorage;
}) {
  const annotations = useReaderAnnotations({
    bookId,
    location: currentLocation,
    openingError,
    readerReady,
    storage,
  });
  useLayoutEffect(() => {
    if (apiRef) apiRef.current = annotations;
  }, [annotations, apiRef]);
  const firstAnnotation = annotations.annotations[0];

  return (
    <div>
      <span data-testid="count">{annotations.annotations.length}</span>
      <span data-testid="ids">{annotations.annotations.map(({ id }) => id).join(",")}</span>
      <span data-testid="labels">
        {annotations.annotations.map(({ label }) => label ?? "").join(",")}
      </span>
      <span data-testid="feedback">{annotations.feedback?.message}</span>
      <span data-testid="busy">{String(annotations.busy)}</span>
      <span data-testid="can-toggle">{String(annotations.canToggleCurrent)}</span>
      <span data-testid="disabled-reason">{annotations.toggleDisabledReason}</span>
      <button onClick={() => void annotations.toggleCurrent()} type="button">
        Toggle
      </button>
      <button onClick={() => void annotations.undoRemove()} type="button">
        Undo
      </button>
      <button
        onClick={() => {
          if (firstAnnotation) void annotations.updateLabel(firstAnnotation, "Updated label");
        }}
        type="button"
      >
        Update first
      </button>
      <button
        onClick={() => {
          if (firstAnnotation) void annotations.remove(firstAnnotation);
        }}
        type="button"
      >
        Remove first
      </button>
    </div>
  );
}

function createStorage(initial: Annotation[] = []) {
  let annotations = structuredClone(initial);
  return {
    listAnnotations: vi.fn(async () => structuredClone(annotations)),
    createAnnotation: vi.fn(async () => {
      const created = bookmark(`bookmark-${annotations.length + 1}`);
      annotations = [...annotations, created];
      return structuredClone(created);
    }),
    restoreAnnotation: vi.fn(async (_bookId: string, annotation: Annotation) => {
      const existing = annotations.find((candidate) => candidate.id === annotation.id);
      if (!existing) annotations = [...annotations, structuredClone(annotation)];
      return structuredClone(existing ?? annotation);
    }),
    deleteAnnotation: vi.fn(async (_bookId: string, id: string) => {
      const previousLength = annotations.length;
      annotations = annotations.filter((candidate) => candidate.id !== id);
      return annotations.length !== previousLength;
    }),
    updateAnnotation: vi.fn(async (_bookId: string, id: string, patch: Partial<Annotation>) => {
      const index = annotations.findIndex((candidate) => candidate.id === id);
      if (index < 0) return undefined;
      const updated = { ...annotations[index], ...patch } as Annotation;
      annotations[index] = updated;
      return structuredClone(updated);
    }),
  } as unknown as LibraryStorage;
}

async function renderHarness(
  storage: LibraryStorage,
  bookId = "book-1",
  apiRef?: MutableRefObject<ReaderAnnotationsApi | undefined>,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await rerenderHarness(storage, bookId, apiRef);
  return container;
}

async function rerenderHarness(
  storage: LibraryStorage,
  bookId: string,
  apiRef?: MutableRefObject<ReaderAnnotationsApi | undefined>,
) {
  await act(async () => {
    root?.render(<HookHarness apiRef={apiRef} bookId={bookId} storage={storage} />);
    await Promise.resolve();
  });
  await act(async () => Promise.resolve());
}

function actionButton(target: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Button ${label} was not rendered.`);
  return match;
}

function text(target: HTMLElement, testId: string): string | null | undefined {
  return target.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useReaderAnnotations", () => {
  it("adds, removes, and immediately restores the current bookmark", async () => {
    const storage = createStorage();
    const rendered = await renderHarness(storage);
    const toggle = actionButton(rendered, "Toggle");
    const undo = actionButton(rendered, "Undo");

    await act(async () => toggle.click());
    expect(text(rendered, "count")).toBe("1");
    expect(storage.createAnnotation).toHaveBeenCalledTimes(1);

    await act(async () => toggle.click());
    expect(text(rendered, "count")).toBe("0");
    expect(text(rendered, "feedback")).toBe("Bookmark removed.");

    await act(async () => undo.click());
    expect(text(rendered, "count")).toBe("1");
    expect(text(rendered, "feedback")).toBe("Bookmark restored.");
    expect(storage.restoreAnnotation).toHaveBeenCalledTimes(1);
    expect(storage.createAnnotation).toHaveBeenCalledTimes(1);

    await act(async () => undo.click());
    expect(text(rendered, "count")).toBe("1");
    expect(storage.restoreAnnotation).toHaveBeenCalledTimes(1);
  });

  it("preserves the complete removed bookmark when undoing", async () => {
    const original = {
      ...bookmark(),
      futureField: { nested: ["preserve-me"] },
    } as unknown as Annotation;
    const storage = createStorage([original]);
    const rendered = await renderHarness(storage);

    await act(async () => actionButton(rendered, "Toggle").click());
    await act(async () => actionButton(rendered, "Undo").click());

    expect(storage.restoreAnnotation).toHaveBeenCalledWith("book-1", original);
  });

  it("keeps bookmark creation unavailable until a current CFI is resolved", async () => {
    const storage = createStorage();
    const unresolved = { ...location, cfi: "" };
    const rendered = await renderHarness(storage);

    await act(async () => {
      root?.render(<HookHarness bookId="book-1" currentLocation={unresolved} storage={storage} />);
    });
    expect(text(rendered, "can-toggle")).toBe("false");
    expect(text(rendered, "disabled-reason")).toBe("Current reading location is still loading.");

    await act(async () => actionButton(rendered, "Toggle").click());
    expect(storage.createAnnotation).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(<HookHarness bookId="book-1" storage={storage} />);
    });
    expect(text(rendered, "can-toggle")).toBe("true");
  });

  it("shows an error and leaves the bookmark removed when exact restoration fails", async () => {
    const storage = createStorage([bookmark()]);
    vi.mocked(storage.restoreAnnotation).mockRejectedValueOnce(new Error("collision"));
    const rendered = await renderHarness(storage);

    await act(async () => actionButton(rendered, "Toggle").click());
    await act(async () => actionButton(rendered, "Undo").click());

    expect(text(rendered, "count")).toBe("0");
    expect(text(rendered, "feedback")).toBe("Bookmark could not be restored.");
  });

  it("ignores a stale bookmark load after switching books", async () => {
    const firstLoad = deferred<Annotation[]>();
    const storage = {
      listAnnotations: vi
        .fn()
        .mockImplementationOnce(() => firstLoad.promise)
        .mockResolvedValueOnce([bookmark("book-2-bookmark")]),
    } as unknown as LibraryStorage;

    const rendered = await renderHarness(storage);
    await rerenderHarness(storage, "book-2");
    expect(text(rendered, "ids")).toBe("book-2-bookmark");

    await act(async () => firstLoad.resolve([bookmark("stale")]));
    expect(text(rendered, "ids")).toBe("book-2-bookmark");
  });

  it("prevents bookmark creation from replacing the new book collection after a switch", async () => {
    const creation = deferred<Annotation>();
    const bookB = bookmark("book-b-bookmark", "Book B");
    const storage = {
      listAnnotations: vi.fn(async (bookId: string) => (bookId === "book-a" ? [] : [bookB])),
      createAnnotation: vi.fn(() => creation.promise),
    } as unknown as LibraryStorage;
    const rendered = await renderHarness(storage, "book-a");

    act(() => actionButton(rendered, "Toggle").click());
    expect(text(rendered, "busy")).toBe("true");

    await rerenderHarness(storage, "book-b");
    expect(text(rendered, "ids")).toBe(bookB.id);
    expect(text(rendered, "busy")).toBe("false");

    await act(async () => creation.resolve(bookmark("stale-book-a", "Stale A")));

    expect(text(rendered, "ids")).toBe(bookB.id);
    expect(text(rendered, "feedback")).toBe("");
    expect(text(rendered, "busy")).toBe("false");
  });

  it("rejects a stale creation after switching away and back to the same book ID", async () => {
    const creation = deferred<Annotation>();
    const bookB = bookmark("book-b-bookmark", "Book B");
    const currentBookA = bookmark("book-a-current", "Current A");
    const storage = {
      listAnnotations: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([bookB])
        .mockResolvedValueOnce([currentBookA]),
      createAnnotation: vi.fn(() => creation.promise),
    } as unknown as LibraryStorage;
    const rendered = await renderHarness(storage, "book-a");

    act(() => actionButton(rendered, "Toggle").click());
    await rerenderHarness(storage, "book-b");
    await rerenderHarness(storage, "book-a");
    expect(text(rendered, "ids")).toBe(currentBookA.id);

    await act(async () => creation.resolve(bookmark("stale-first-book-a", "Stale A")));

    expect(text(rendered, "ids")).toBe(currentBookA.id);
    expect(text(rendered, "labels")).toBe("Current A");
    expect(text(rendered, "feedback")).toBe("");
    expect(text(rendered, "busy")).toBe("false");
  });

  it("prevents a stale label update from modifying the new book collection", async () => {
    const update = deferred<Annotation | undefined>();
    const bookA = bookmark("book-a-bookmark", "Book A");
    const bookB = bookmark("book-b-bookmark", "Book B");
    const storage = {
      listAnnotations: vi.fn(async (bookId: string) => (bookId === "book-a" ? [bookA] : [bookB])),
      updateAnnotation: vi.fn(() => update.promise),
    } as unknown as LibraryStorage;
    const rendered = await renderHarness(storage, "book-a");

    act(() => actionButton(rendered, "Update first").click());
    await rerenderHarness(storage, "book-b");

    await act(async () => update.resolve({ ...bookA, label: "Stale update" }));

    expect(text(rendered, "ids")).toBe(bookB.id);
    expect(text(rendered, "labels")).toBe("Book B");
    expect(text(rendered, "feedback")).toBe("");
  });

  it("keeps newer busy ownership and suppresses stale delete feedback after a book switch", async () => {
    const deleteBookA = deferred<boolean>();
    const updateBookB = deferred<Annotation | undefined>();
    const bookA = bookmark("book-a-bookmark", "Book A");
    const bookB = bookmark("book-b-bookmark", "Book B");
    const storage = {
      listAnnotations: vi.fn(async (bookId: string) => (bookId === "book-a" ? [bookA] : [bookB])),
      deleteAnnotation: vi.fn(() => deleteBookA.promise),
      updateAnnotation: vi.fn(() => updateBookB.promise),
    } as unknown as LibraryStorage;
    const rendered = await renderHarness(storage, "book-a");

    act(() => actionButton(rendered, "Remove first").click());
    expect(text(rendered, "busy")).toBe("true");

    await rerenderHarness(storage, "book-b");
    act(() => actionButton(rendered, "Update first").click());
    expect(text(rendered, "busy")).toBe("true");

    await act(async () => deleteBookA.resolve(true));

    expect(text(rendered, "ids")).toBe(bookB.id);
    expect(text(rendered, "feedback")).toBe("");
    expect(text(rendered, "busy")).toBe("true");

    await act(async () => updateBookB.resolve({ ...bookB, label: "Updated label" }));

    expect(text(rendered, "labels")).toBe("Updated label");
    expect(text(rendered, "busy")).toBe("false");
  });

  it("rejects stale synchronization callbacks after returning to the same book ID", async () => {
    const firstBookA = bookmark("book-a-first", "First A");
    const bookB = bookmark("book-b", "Book B");
    const secondBookA = bookmark("book-a-second", "Second A");
    const storage = {
      listAnnotations: vi
        .fn()
        .mockResolvedValueOnce([firstBookA])
        .mockResolvedValueOnce([bookB])
        .mockResolvedValueOnce([secondBookA]),
    } as unknown as LibraryStorage;
    const apiRef: MutableRefObject<ReaderAnnotationsApi | undefined> = { current: undefined };
    const rendered = await renderHarness(storage, "book-a", apiRef);
    const staleBookAApi = apiRef.current;

    await rerenderHarness(storage, "book-b", apiRef);
    await rerenderHarness(storage, "book-a", apiRef);
    expect(text(rendered, "ids")).toBe(secondBookA.id);

    act(() => {
      staleBookAApi?.sync(bookmark("stale-sync", "Stale sync"));
      staleBookAApi?.forget(secondBookA.id);
    });

    expect(text(rendered, "ids")).toBe(secondBookA.id);
    expect(text(rendered, "labels")).toBe("Second A");
  });
});
