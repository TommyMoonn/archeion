// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { deriveSeriesEntries } from "./seriesDerivation";
import { SeriesDetail } from "./SeriesDetail";
import { SeriesOverview } from "./SeriesOverview";

vi.mock("../library/BookCover", () => ({
  BookCover: ({ book, className = "" }: { book: Book; className?: string }) => (
    <div className={className} data-cover-book={book.id} />
  ),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

function createBook(overrides: Partial<Book> & Pick<Book, "id">): Book {
  return {
    fileName: `${overrides.id}.epub`,
    originalTitle: overrides.id,
    isFavorite: false,
    addedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function seriesBooks(): Book[] {
  return [
    createBook({
      id: "volume-1",
      originalTitle: "The Beginning",
      progressPercent: 100,
      sourceMetadata: { series: "Star Saga", volume: "Vol. 01" },
    }),
    createBook({
      id: "volume-2",
      originalTitle: "The Crossing",
      lastOpenedAt: "2026-07-05T00:00:00.000Z",
      progressPercent: 45,
      sourceMetadata: { series: "Star Saga", volume: "2" },
    }),
    createBook({
      id: "volume-4",
      originalTitle: "The Return",
      sourceMetadata: { series: "Star Saga", volume: "4" },
    }),
  ];
}

function mount(node: React.ReactNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

function buttonWithText(scope: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );

  if (!button) {
    throw new Error(`Button ${text} was not rendered.`);
  }

  return button;
}

describe("series library surfaces", () => {
  it("renders searchable series summaries and opens or continues a series", () => {
    const entries = deriveSeriesEntries([
      ...seriesBooks(),
      createBook({
        id: "moon-1",
        sourceMetadata: { series: "Moon Tales", volume: "1" },
      }),
    ]);
    const onOpen = vi.fn();
    const onRead = vi.fn();
    const scope = mount(
      <SeriesOverview
        entries={entries}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={onOpen}
        onQueryChange={vi.fn()}
        onRead={onRead}
        query="star"
      />,
    );

    expect(scope.textContent).toContain("Star Saga");
    expect(scope.textContent).not.toContain("Moon Tales");
    expect(scope.textContent).toContain("3 volumes");
    expect(scope.textContent).toContain("1 in progress · 1 complete · 1 unread");
    expect(scope.querySelector('[data-cover-book="volume-1"]')).not.toBeNull();

    act(() => scope.querySelector<HTMLButtonElement>('[aria-label="Open Star Saga"]')?.click());
    act(() => buttonWithText(scope, "Continue").click());

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "star saga" }));
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ id: "volume-2" }));
  });

  it("renders ordered volumes, conservative hints, and current/next markers", () => {
    const entry = deriveSeriesEntries(seriesBooks())[0]!;
    const onRead = vi.fn();
    const scope = mount(<SeriesDetail entry={entry} onBack={vi.fn()} onRead={onRead} />);
    const volumeRows = Array.from(scope.querySelectorAll(".series-volume"));

    expect(volumeRows.map((row) => row.querySelector("h2")?.textContent)).toEqual([
      "The Beginning",
      "The Crossing",
      "The Return",
    ]);
    expect(scope.textContent).toContain("Volume 3 may be missing");
    expect(
      scope.querySelector('[data-marker="current"]')?.parentElement?.parentElement?.textContent,
    ).toContain("The Crossing");
    expect(
      scope.querySelector('[data-marker="next"]')?.parentElement?.parentElement?.textContent,
    ).toContain("The Return");
    expect(scope.textContent).toContain("Vol. 01");

    act(() => buttonWithText(scope, "Continue Series").click());
    act(() => buttonWithText(scope, "Open next unread").click());

    expect(onRead.mock.calls.map(([book]) => book.id)).toEqual(["volume-2", "volume-4"]);
  });

  it("shows a recovery state for a stale series location", () => {
    const onBack = vi.fn();
    const scope = mount(<SeriesDetail onBack={onBack} onRead={vi.fn()} />);

    expect(scope.textContent).toContain("Series not found");
    act(() => buttonWithText(scope, "Back to Series").click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
