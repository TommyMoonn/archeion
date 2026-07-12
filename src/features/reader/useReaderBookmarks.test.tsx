// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation } from "../../types/annotation";
import { useReaderBookmarks } from "./useReaderBookmarks";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const location = {
  atEnd: false,
  atStart: false,
  cfi: "epubcfi(/6/2!/4/2:10)",
  percentage: 12.5,
};

function bookmark(id = "bookmark-1"): Annotation {
  return {
    id,
    type: "bookmark",
    cfiRange: location.cfi,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
}

function HookHarness({
  bookId,
  currentLocation = location,
  openingError = false,
  readerReady = true,
  storage,
}: {
  bookId: string;
  currentLocation?: typeof location;
  openingError?: boolean;
  readerReady?: boolean;
  storage: LibraryStorage;
}) {
  const bookmarks = useReaderBookmarks({
    bookId,
    location: currentLocation,
    openingError,
    readerReady,
    storage,
  });
  return (
    <div>
      <span data-testid="count">{bookmarks.bookmarks.length}</span>
      <span data-testid="feedback">{bookmarks.feedback?.message}</span>
      <span data-testid="can-toggle">{String(bookmarks.canToggleCurrent)}</span>
      <span data-testid="disabled-reason">{bookmarks.toggleDisabledReason}</span>
      <button onClick={() => void bookmarks.toggleCurrent()} type="button">
        Toggle
      </button>
      <button onClick={() => void bookmarks.undoRemove()} type="button">
        Undo
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
    updateAnnotation: vi.fn(),
  } as unknown as LibraryStorage;
}

async function renderHarness(storage: LibraryStorage, bookId = "book-1") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<HookHarness bookId={bookId} storage={storage} />);
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

describe("useReaderBookmarks", () => {
  it("adds, removes, and immediately restores the current bookmark", async () => {
    const storage = createStorage();
    const rendered = await renderHarness(storage);
    const toggle = rendered.querySelector<HTMLButtonElement>("button");
    const undo = rendered.querySelectorAll<HTMLButtonElement>("button")[1];

    await act(async () => toggle?.click());
    expect(rendered.querySelector('[data-testid="count"]')?.textContent).toBe("1");
    expect(storage.createAnnotation).toHaveBeenCalledTimes(1);

    await act(async () => toggle?.click());
    expect(rendered.querySelector('[data-testid="count"]')?.textContent).toBe("0");
    expect(rendered.querySelector('[data-testid="feedback"]')?.textContent).toBe(
      "Bookmark removed.",
    );

    await act(async () => undo?.click());
    expect(rendered.querySelector('[data-testid="count"]')?.textContent).toBe("1");
    expect(rendered.querySelector('[data-testid="feedback"]')?.textContent).toBe(
      "Bookmark restored.",
    );
    expect(storage.restoreAnnotation).toHaveBeenCalledTimes(1);
    expect(storage.createAnnotation).toHaveBeenCalledTimes(1);

    await act(async () => undo?.click());
    expect(rendered.querySelector('[data-testid="count"]')?.textContent).toBe("1");
    expect(storage.restoreAnnotation).toHaveBeenCalledTimes(1);
  });

  it("preserves the complete removed bookmark when undoing", async () => {
    const original = {
      ...bookmark(),
      note: "Remember this",
      color: "yellow",
      selectedText: "Quoted passage",
      futureField: { nested: ["preserve-me"] },
    };
    const storage = createStorage([original]);
    const rendered = await renderHarness(storage);
    const toggle = rendered.querySelector<HTMLButtonElement>("button");
    const undo = rendered.querySelectorAll<HTMLButtonElement>("button")[1];

    await act(async () => toggle?.click());
    await act(async () => undo?.click());

    expect(storage.restoreAnnotation).toHaveBeenCalledWith("book-1", original);
  });

  it("keeps bookmark creation unavailable until a current CFI is resolved", async () => {
    const storage = createStorage();
    const unresolved = { ...location, cfi: "" };
    const rendered = await renderHarness(storage);

    await act(async () => {
      root?.render(<HookHarness bookId="book-1" currentLocation={unresolved} storage={storage} />);
    });
    expect(rendered.querySelector('[data-testid="can-toggle"]')?.textContent).toBe("false");
    expect(rendered.querySelector('[data-testid="disabled-reason"]')?.textContent).toBe(
      "Current reading location is still loading.",
    );

    await act(async () => rendered.querySelector<HTMLButtonElement>("button")?.click());
    expect(storage.createAnnotation).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(<HookHarness bookId="book-1" storage={storage} />);
    });
    expect(rendered.querySelector('[data-testid="can-toggle"]')?.textContent).toBe("true");
  });

  it("shows an error and leaves the bookmark removed when exact restoration fails", async () => {
    const storage = createStorage([bookmark()]);
    vi.mocked(storage.restoreAnnotation).mockRejectedValueOnce(new Error("collision"));
    const rendered = await renderHarness(storage);
    const buttons = rendered.querySelectorAll<HTMLButtonElement>("button");

    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());

    expect(rendered.querySelector('[data-testid="count"]')?.textContent).toBe("0");
    expect(rendered.querySelector('[data-testid="feedback"]')?.textContent).toBe(
      "Bookmark could not be restored.",
    );
  });

  it("ignores a stale bookmark load after switching books", async () => {
    let resolveFirst!: (value: Annotation[]) => void;
    const firstLoad = new Promise<Annotation[]>((resolve) => {
      resolveFirst = resolve;
    });
    const storage = {
      listAnnotations: vi
        .fn()
        .mockImplementationOnce(() => firstLoad)
        .mockResolvedValueOnce([bookmark("book-2-bookmark")]),
    } as unknown as LibraryStorage;

    const rendered = await renderHarness(storage);
    await act(async () => {
      root?.render(<HookHarness bookId="book-2" storage={storage} />);
      await Promise.resolve();
    });
    expect(rendered.querySelector('[data-testid="count"]')?.textContent).toBe("1");

    await act(async () => {
      resolveFirst([bookmark("stale")]);
      await firstLoad;
    });
    expect(rendered.querySelector('[data-testid="count"]')?.textContent).toBe("1");
  });
});
