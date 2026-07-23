// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { ContinueReading } from "./ContinueReading";

vi.mock("./BookCover", () => ({
  BookCover: () => <span aria-hidden="true" data-cover />,
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    addedAt: "2026-07-01T00:00:00.000Z",
    fileName: "book.epub",
    id: "book",
    isFavorite: false,
    originalTitle: "Accessible Book",
    progressPercent: 40,
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderContinue(book: Book) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onContinue = vi.fn();
  act(() => root?.render(<ContinueReading books={[book]} onContinue={onContinue} />));
  return { button: container.querySelector<HTMLButtonElement>(".continue-book")!, onContinue };
}

describe("ContinueReading", () => {
  it("keeps available books actionable with decorative cover content hidden", () => {
    const rendered = renderContinue(createBook());

    expect(rendered.button.getAttribute("aria-disabled")).toBeNull();
    expect(rendered.button.querySelector("[data-cover]")?.getAttribute("aria-hidden")).toBe("true");
    act(() => rendered.button.click());
    expect(rendered.onContinue).toHaveBeenCalledTimes(1);
  });

  it("keeps a missing book understandable without allowing it to open", () => {
    const rendered = renderContinue(createBook({ isFileMissing: true }));
    const reasonId = rendered.button.getAttribute("aria-describedby")!;

    expect(rendered.button.disabled).toBe(false);
    expect(rendered.button.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(reasonId)?.textContent).toContain("Reading is unavailable");
    act(() => rendered.button.click());
    expect(rendered.onContinue).not.toHaveBeenCalled();
  });
});
