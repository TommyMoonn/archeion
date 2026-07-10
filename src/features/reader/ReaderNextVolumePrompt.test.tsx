// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { ReaderNextVolumePrompt } from "./ReaderNextVolumePrompt";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const book: Book = {
  addedAt: "2026-07-01T00:00:00.000Z",
  fileName: "Volume 2.epub",
  id: "volume-2",
  isFavorite: false,
  originalTitle: "The Second Volume",
  sourceMetadata: { series: "Star Saga", volume: "2" },
  updatedAt: "2026-07-01T00:00:00.000Z",
};

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

function renderPrompt(renderedBook: Book = book) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onOpen = vi.fn();

  act(() => {
    root?.render(<ReaderNextVolumePrompt book={renderedBook} onOpen={onOpen} />);
  });

  return { container, onOpen };
}

describe("ReaderNextVolumePrompt", () => {
  it("shows the next known volume without opening it automatically", () => {
    const rendered = renderPrompt();
    const button = rendered.container.querySelector<HTMLButtonElement>("button");

    expect(rendered.container.textContent).toContain("Next volume · 2");
    expect(rendered.container.textContent).toContain("The Second Volume");
    expect(rendered.onOpen).not.toHaveBeenCalled();

    act(() => button?.click());

    expect(rendered.onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps a known missing volume visible but unavailable", () => {
    const rendered = renderPrompt({ ...book, isFileMissing: true });
    const button = rendered.container.querySelector<HTMLButtonElement>("button");

    expect(button?.disabled).toBe(true);
    expect(rendered.container.textContent).toContain("The Second Volume");
  });
});
