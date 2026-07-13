// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import { useReaderHighlights } from "./useReaderHighlights";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const timestamp = "2026-07-12T00:00:00.000Z";
const existingHighlight: HighlightAnnotation = {
  cfiRange: "epubcfi(/6/2!/4/2,/1:1,/1:8)",
  color: "yellow",
  createdAt: timestamp,
  id: "highlight-1",
  selectedText: "Existing quote",
  type: "highlight",
  updatedAt: timestamp,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function Harness({
  annotations,
  bookId = "book-1",
  onChange,
  storage,
}: {
  annotations: readonly Annotation[];
  bookId?: string;
  onChange: (annotation: Annotation) => void;
  storage: LibraryStorage;
}) {
  const highlights = useReaderHighlights({
    annotations,
    bookId,
    onAnnotationChange: onChange,
    storage,
  });

  return (
    <div>
      <span data-testid="count">{highlights.highlights.length}</span>
      <button
        onClick={() =>
          void highlights.create(
            {
              cfiRange: "epubcfi(/6/4!/4/2,/1:1,/1:8)",
              contextAfter: "After the quote",
              contextBefore: "Before the quote",
              selectedText: "New quote",
            },
            "green",
          )
        }
        type="button"
      >
        Create
      </button>
      <button onClick={() => void highlights.recolor(existingHighlight.id, "blue")} type="button">
        Recolor
      </button>
      <button
        onClick={() =>
          void highlights.create(
            { cfiRange: "epubcfi(/6/2!/4/2,/1:2,/1:5)", selectedText: "Contained" },
            "green",
          )
        }
        type="button"
      >
        Contained
      </button>
      <button
        onClick={() =>
          void highlights.create(
            { cfiRange: "epubcfi(/6/2!/4/2,/1:5,/1:12)", selectedText: "Partial" },
            "green",
          )
        }
        type="button"
      >
        Partial overlap
      </button>
      <button
        onClick={() => highlights.reportInteractionFeedback("The highlight could not be saved.")}
        type="button"
      >
        Report interaction
      </button>
      <button onClick={highlights.clearInteractionFeedback} type="button">
        Clear interaction
      </button>
      <button
        onClick={() =>
          void highlights.ensure({
            cfiRange: "epubcfi(/6/8!/4/2,/1:1,/1:8)",
            selectedText: "Note passage",
          })
        }
        type="button"
      >
        Highlight and add note
      </button>
      <span data-testid="error">{highlights.error}</span>
      <span data-testid="feedback-kind">{highlights.feedback?.kind}</span>
    </div>
  );
}

function createStorage() {
  const created: HighlightAnnotation = {
    ...existingHighlight,
    cfiRange: "epubcfi(/6/4!/4/2,/1:1,/1:8)",
    color: "green",
    id: "highlight-2",
    selectedText: "New quote",
  };
  const recolored: HighlightAnnotation = { ...existingHighlight, color: "blue" };

  return {
    createAnnotation: vi.fn(async () => created),
    listAnnotations: vi.fn(async () => {
      throw new Error("highlight state must come from the shared annotation collection");
    }),
    updateAnnotation: vi.fn(async () => recolored),
  } as unknown as LibraryStorage;
}

async function renderHarness(storage: LibraryStorage, onChange = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <Harness annotations={[existingHighlight]} onChange={onChange} storage={storage} />,
    );
  });
  return { container, onChange };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useReaderHighlights", () => {
  it("derives highlights from the shared annotation collection without reloading storage", async () => {
    const storage = createStorage();
    const rendered = await renderHarness(storage);

    expect(rendered.container.querySelector('[data-testid="count"]')?.textContent).toBe("1");
    expect(storage.listAnnotations).not.toHaveBeenCalled();
  });

  it("publishes create and recolor mutations to the shared collection", async () => {
    const storage = createStorage();
    const rendered = await renderHarness(storage);
    const buttons = rendered.container.querySelectorAll<HTMLButtonElement>("button");

    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());

    expect(rendered.onChange).toHaveBeenCalledTimes(2);
    expect(rendered.onChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "highlight-2", color: "green" }),
    );
    expect(storage.createAnnotation).toHaveBeenCalledWith("book-1", {
      cfiRange: "epubcfi(/6/4!/4/2,/1:1,/1:8)",
      chapterHref: undefined,
      color: "green",
      contextAfter: "After the quote",
      contextBefore: "Before the quote",
      selectedText: "New quote",
      type: "highlight",
    });
    expect(rendered.onChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "highlight-1", color: "blue" }),
    );
  });

  it("does not publish a stale recolor completion into another book session", async () => {
    const pendingRecolor = deferred<HighlightAnnotation>();
    const storage = createStorage();
    vi.mocked(storage.updateAnnotation).mockImplementationOnce(() => pendingRecolor.promise);
    const onChange = vi.fn();
    const rendered = await renderHarness(storage, onChange);

    act(() => rendered.container.querySelectorAll<HTMLButtonElement>("button")[1]?.click());
    expect(storage.updateAnnotation).toHaveBeenCalledWith("book-1", existingHighlight.id, {
      color: "blue",
    });

    await act(async () => {
      root?.render(
        <Harness annotations={[]} bookId="book-2" onChange={onChange} storage={storage} />,
      );
    });
    await act(async () =>
      pendingRecolor.resolve({ ...existingHighlight, color: "blue", updatedAt: timestamp }),
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(rendered.container.querySelector('[data-testid="count"]')?.textContent).toBe("0");
  });

  it("creates the highlight for a fresh note selection with the default color", async () => {
    const storage = createStorage();
    const rendered = await renderHarness(storage);
    const buttons = rendered.container.querySelectorAll<HTMLButtonElement>("button");

    await act(async () => buttons[6]?.click());

    expect(storage.createAnnotation).toHaveBeenCalledWith("book-1", {
      cfiRange: "epubcfi(/6/8!/4/2,/1:1,/1:8)",
      chapterHref: undefined,
      color: "yellow",
      selectedText: "Note passage",
      type: "highlight",
    });
  });

  it("updates a containing highlight by stable ID instead of creating a duplicate", async () => {
    const storage = createStorage();
    const rendered = await renderHarness(storage);
    const buttons = rendered.container.querySelectorAll<HTMLButtonElement>("button");

    await act(async () => buttons[2]?.click());

    expect(storage.updateAnnotation).toHaveBeenCalledWith("book-1", "highlight-1", {
      color: "green",
    });
    expect(storage.createAnnotation).not.toHaveBeenCalled();
  });

  it("blocks partial overlap before storage mutation", async () => {
    const storage = createStorage();
    const rendered = await renderHarness(storage);
    const buttons = rendered.container.querySelectorAll<HTMLButtonElement>("button");

    await act(async () => buttons[3]?.click());

    expect(storage.updateAnnotation).not.toHaveBeenCalled();
    expect(storage.createAnnotation).not.toHaveBeenCalled();
    expect(rendered.container.querySelector('[data-testid="error"]')?.textContent).toBe(
      "Overlapping highlights cannot be edited together.",
    );
  });

  it("clears transient overlap feedback without inferring its category from copy", async () => {
    const storage = createStorage();
    const rendered = await renderHarness(storage);
    const buttons = rendered.container.querySelectorAll<HTMLButtonElement>("button");

    await act(async () => buttons[3]?.click());
    expect(rendered.container.querySelector('[data-testid="feedback-kind"]')?.textContent).toBe(
      "interaction",
    );
    await act(async () => buttons[5]?.click());
    expect(rendered.container.querySelector('[data-testid="error"]')?.textContent).toBe("");

    await act(async () => buttons[4]?.click());
    expect(rendered.container.querySelector('[data-testid="error"]')?.textContent).toBe(
      "The highlight could not be saved.",
    );
    expect(rendered.container.querySelector('[data-testid="feedback-kind"]')?.textContent).toBe(
      "interaction",
    );
    await act(async () => buttons[5]?.click());
    expect(rendered.container.querySelector('[data-testid="error"]')?.textContent).toBe("");
  });

  it("keeps persistence failures visible when transient feedback is cleared", async () => {
    const storage = createStorage();
    vi.mocked(storage.createAnnotation).mockRejectedValueOnce(new Error("disk unavailable"));
    const rendered = await renderHarness(storage);
    const buttons = rendered.container.querySelectorAll<HTMLButtonElement>("button");

    await act(async () => buttons[0]?.click());
    expect(rendered.container.querySelector('[data-testid="feedback-kind"]')?.textContent).toBe(
      "persistence",
    );
    await act(async () => buttons[5]?.click());
    expect(rendered.container.querySelector('[data-testid="error"]')?.textContent).toBe(
      "The highlight could not be saved.",
    );
  });
});
