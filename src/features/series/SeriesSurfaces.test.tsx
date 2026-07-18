// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { deriveSeriesEntries } from "./seriesDerivation";
import { SeriesDetail } from "./SeriesDetail";
import { SeriesOverview } from "./SeriesOverview";

const seriesStyles = readFileSync(resolve(process.cwd(), "src/styles/features/series.css"), "utf8");

function cssBlock(source: string, selector: string): string {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const openingBrace = source.indexOf("{", selectorIndex + selector.length);
  if (openingBrace < 0) throw new Error(`Missing opening brace for: ${selector}`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Missing closing brace for: ${selector}`);
}

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
  it("makes each searchable series summary one complete open target", () => {
    const entries = deriveSeriesEntries([
      ...seriesBooks(),
      createBook({
        id: "moon-1",
        sourceMetadata: { series: "Moon Tales", volume: "1" },
      }),
    ]);
    const onOpen = vi.fn();
    const scope = mount(
      <SeriesOverview
        entries={entries}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={onOpen}
        onQueryChange={vi.fn()}
        query="star"
      />,
    );

    expect(scope.textContent).toContain("Star Saga");
    expect(scope.textContent).not.toContain("Moon Tales");
    expect(scope.textContent).toContain("3 volumes");
    expect(scope.textContent).toContain("1 in progress · 1 complete · 1 unread");
    expect(scope.querySelector('[data-cover-book="volume-1"]')).not.toBeNull();

    const card = scope.querySelector<HTMLElement>(".series-card");
    const openButton = card?.querySelector<HTMLButtonElement>('[aria-label="Open Star Saga"]');

    expect(card?.querySelectorAll("button")).toHaveLength(1);
    expect(openButton?.querySelector('[data-cover-book="volume-1"]')).not.toBeNull();
    expect(openButton?.querySelector("svg")).not.toBeNull();
    expect(scope.textContent).not.toContain("Continue");

    act(() => openButton?.click());

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "star saga" }));
  });

  it("keeps the full series open target visibly interactive", () => {
    const openTargetStyles = cssBlock(seriesStyles, ".series-card__open");
    const hoverStyles = cssBlock(seriesStyles, ".series-card:hover,\n.series-card:focus-within");

    expect(openTargetStyles).toContain("width: 100%;");
    expect(openTargetStyles).toContain("cursor: pointer;");
    expect(hoverStyles).toContain("background: var(--surface-raised);");
  });

  it("renders ordered volumes, conservative hints, and continuation markers", () => {
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
      scope.querySelector('[data-marker="unread"]')?.parentElement?.parentElement?.textContent,
    ).toContain("The Return");
    expect(scope.textContent).toContain("Vol. 01");
    expect(seriesStyles).not.toContain(".series-volume[data-current]");
    expect(seriesStyles).not.toContain(".series-volume[data-unread]");
    expect(
      Array.from(scope.querySelectorAll(".series-volume > .button")).every((button) =>
        button.classList.contains("button--ghost"),
      ),
    ).toBe(true);

    act(() => buttonWithText(scope, "Continue Series").click());

    expect(onRead.mock.calls.map(([book]) => book.id)).toEqual(["volume-2"]);
    expect(scope.textContent).not.toContain("Open next unread");
  });

  it("shows a recovery state for a stale series location", () => {
    const onBack = vi.fn();
    const scope = mount(<SeriesDetail onBack={onBack} onRead={vi.fn()} />);

    expect(scope.textContent).toContain("Series not found");
    act(() => buttonWithText(scope, "Back to Series").click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
