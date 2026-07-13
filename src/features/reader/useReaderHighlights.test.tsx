// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation } from "../../types/annotation";
import { useReaderHighlights } from "./useReaderHighlights";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const timestamp = "2026-07-12T00:00:00.000Z";
const existingHighlight: Annotation = {
  cfiRange: "epubcfi(/6/2)",
  color: "yellow",
  createdAt: timestamp,
  id: "highlight-1",
  selectedText: "Existing quote",
  type: "highlight",
  updatedAt: timestamp,
};

function Harness({
  annotations,
  onChange,
  onRemove,
  storage,
}: {
  annotations: readonly Annotation[];
  onChange: (annotation: Annotation) => void;
  onRemove: (annotationId: string) => void;
  storage: LibraryStorage;
}) {
  const highlights = useReaderHighlights({
    annotations,
    bookId: "book-1",
    onAnnotationChange: onChange,
    onAnnotationRemove: onRemove,
    storage,
  });

  return (
    <div>
      <span data-testid="count">{highlights.highlights.length}</span>
      <button
        onClick={() =>
          void highlights.create({ cfiRange: "epubcfi(/6/4)", selectedText: "New quote" }, "green")
        }
        type="button"
      >
        Create
      </button>
      <button onClick={() => void highlights.recolor(existingHighlight.id, "blue")} type="button">
        Recolor
      </button>
      <button onClick={() => void highlights.remove(existingHighlight.id)} type="button">
        Remove
      </button>
    </div>
  );
}

function createStorage() {
  const created: Annotation = {
    ...existingHighlight,
    cfiRange: "epubcfi(/6/4)",
    color: "green",
    id: "highlight-2",
    selectedText: "New quote",
  };
  const recolored: Annotation = { ...existingHighlight, color: "blue" };

  return {
    createAnnotation: vi.fn(async () => created),
    deleteAnnotation: vi.fn(async () => true),
    listAnnotations: vi.fn(async () => {
      throw new Error("highlight state must come from the shared annotation collection");
    }),
    updateAnnotation: vi.fn(async () => recolored),
  } as unknown as LibraryStorage;
}

async function renderHarness(storage: LibraryStorage, onChange = vi.fn(), onRemove = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <Harness
        annotations={[existingHighlight]}
        onChange={onChange}
        onRemove={onRemove}
        storage={storage}
      />,
    );
  });
  return { container, onChange, onRemove };
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

  it("publishes create, recolor, and removal mutations to the shared collection", async () => {
    const storage = createStorage();
    const rendered = await renderHarness(storage);
    const buttons = rendered.container.querySelectorAll<HTMLButtonElement>("button");

    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    await act(async () => buttons[2]?.click());

    expect(rendered.onChange).toHaveBeenCalledTimes(2);
    expect(rendered.onChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "highlight-2", color: "green" }),
    );
    expect(rendered.onChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "highlight-1", color: "blue" }),
    );
    expect(rendered.onRemove).toHaveBeenCalledWith("highlight-1");
  });
});
