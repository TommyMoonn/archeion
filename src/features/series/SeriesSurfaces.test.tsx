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
        cardSize="medium"
        entries={entries}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={onOpen}
        onQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query="star"
        sort="title"
        view="grid"
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

  it("restores the logical series after returning from detail", () => {
    const entries = deriveSeriesEntries([
      ...seriesBooks(),
      createBook({
        id: "moon-1",
        sourceMetadata: { series: "Moon Tales", volume: "1" },
      }),
    ]);
    const onReturnFocusComplete = vi.fn();
    const scope = mount(
      <SeriesOverview
        cardSize="medium"
        entries={entries}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onReturnFocusComplete={onReturnFocusComplete}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query=""
        returnFocusKey="star saga"
        sort="title"
        view="grid"
      />,
    );

    const target = scope.querySelector<HTMLButtonElement>('[data-library-series-key="star saga"]');
    expect(document.activeElement).toBe(target);
    expect(onReturnFocusComplete).toHaveBeenCalledTimes(1);
  });

  it("retires a filtered return key and falls back to Series search when focus is unowned", () => {
    const entries = deriveSeriesEntries([
      ...seriesBooks(),
      createBook({
        id: "moon-1",
        sourceMetadata: { series: "Moon Tales", volume: "1" },
      }),
    ]);
    const onReturnFocusComplete = vi.fn();
    const renderOverview = (query: string) => (
      <SeriesOverview
        cardSize="medium"
        entries={entries}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onReturnFocusComplete={onReturnFocusComplete}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query={query}
        returnFocusKey="star saga"
        sort="title"
        view="grid"
      />
    );
    const scope = mount(renderOverview("moon"));

    expect(document.activeElement).toBe(
      scope.querySelector('input[name="archeion-series-search"]'),
    );
    expect(onReturnFocusComplete).toHaveBeenCalledTimes(1);

    act(() => root?.render(renderOverview("")));

    expect(document.activeElement).not.toBe(
      scope.querySelector('[data-library-series-key="star saga"]'),
    );
    expect(onReturnFocusComplete).toHaveBeenCalledTimes(1);
  });

  it("retires a filtered return key without overwriting user focus", () => {
    const entries = deriveSeriesEntries([
      ...seriesBooks(),
      createBook({
        id: "moon-1",
        sourceMetadata: { series: "Moon Tales", volume: "1" },
      }),
    ]);
    const outside = document.body.appendChild(document.createElement("button"));
    outside.textContent = "Persistent owner";
    outside.focus();
    const onReturnFocusComplete = vi.fn();

    mount(
      <SeriesOverview
        cardSize="medium"
        entries={entries}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onReturnFocusComplete={onReturnFocusComplete}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query="moon"
        returnFocusKey="star saga"
        sort="title"
        view="grid"
      />,
    );

    expect(document.activeElement).toBe(outside);
    expect(onReturnFocusComplete).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it("uses the same safe fallback when the returned series no longer exists", () => {
    const entries = deriveSeriesEntries([
      createBook({
        id: "moon-1",
        sourceMetadata: { series: "Moon Tales", volume: "1" },
      }),
    ]);
    const onReturnFocusComplete = vi.fn();
    const scope = mount(
      <SeriesOverview
        cardSize="medium"
        entries={entries}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onReturnFocusComplete={onReturnFocusComplete}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query=""
        returnFocusKey="star saga"
        sort="title"
        view="grid"
      />,
    );

    expect(document.activeElement).toBe(
      scope.querySelector('input[name="archeion-series-search"]'),
    );
    expect(onReturnFocusComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps the same focused series through sorting, view, and card-size changes", () => {
    const entries = deriveSeriesEntries([
      ...seriesBooks(),
      createBook({
        id: "moon-1",
        sourceMetadata: { series: "Moon Tales", volume: "1" },
      }),
    ]);
    const renderOverview = (
      sort: "title" | "most-volumes",
      view: "grid" | "list",
      cardSize: "small" | "large",
    ) => (
      <SeriesOverview
        cardSize={cardSize}
        entries={entries}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query=""
        sort={sort}
        view={view}
      />
    );
    const scope = mount(renderOverview("title", "grid", "small"));
    const target = scope.querySelector<HTMLButtonElement>(
      '[data-library-series-key="moon tales"]',
    )!;
    target.focus();

    act(() => root?.render(renderOverview("most-volumes", "list", "large")));

    expect(document.activeElement).toBe(
      scope.querySelector('[data-library-series-key="moon tales"]'),
    );
  });

  it("places the count on row two and switches the series collection between grid and list", () => {
    const entries = deriveSeriesEntries([
      ...seriesBooks(),
      createBook({
        id: "moon-1",
        sourceMetadata: { series: "Moon Tales", volume: "1" },
      }),
    ]);
    const onViewChange = vi.fn();
    const scope = mount(
      <SeriesOverview
        cardSize="medium"
        entries={entries}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={onViewChange}
        query=""
        sort="title"
        view="grid"
      />,
    );

    const controls = scope.querySelector(".series-overview__controls");
    const collection = scope.querySelector(".series-grid");
    const listButton = scope.querySelector<HTMLButtonElement>('[role="radio"][aria-label="List"]');

    expect(controls?.firstElementChild?.textContent).toBe("2 series");
    expect(controls?.lastElementChild?.querySelector('[aria-label="Series view"]')).not.toBeNull();
    expect(collection?.classList.contains("series-grid--grid")).toBe(true);

    act(() => listButton?.click());

    expect(onViewChange).toHaveBeenCalledWith("list");
    expect(collection?.classList.contains("series-grid--grid")).toBe(true);
  });

  it("routes sort changes through the controlled preference callback", () => {
    const onSortChange = vi.fn();
    const scope = mount(
      <SeriesOverview
        cardSize="large"
        entries={deriveSeriesEntries(seriesBooks())}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onSortChange={onSortChange}
        onViewChange={vi.fn()}
        query=""
        sort="title"
        view="grid"
      />,
    );

    act(() => scope.querySelector<HTMLButtonElement>('[aria-label="Sort series"]')?.click());
    const mostVolumes = Array.from(scope.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes("Most volumes"),
    );
    act(() => mostVolumes?.click());

    expect(onSortChange).toHaveBeenCalledWith("most-volumes");
    expect(scope.querySelector(".series-grid")?.getAttribute("data-series-card-size")).toBe(
      "large",
    );
  });

  it("keeps the full series open target visibly interactive", () => {
    const openTargetStyles = cssBlock(seriesStyles, ".series-card__open");
    const hoverStyles = cssBlock(seriesStyles, ".series-card:hover,\n.series-card:focus-within");

    expect(openTargetStyles).toContain("width: 100%;");
    expect(openTargetStyles).toContain("cursor: pointer;");
    expect(hoverStyles).toContain("background: var(--surface-raised);");
  });

  it("uses the shared collection-content layout for series empty states", () => {
    const scope = mount(
      <SeriesOverview
        cardSize="medium"
        entries={[]}
        isLoading={false}
        onClearSearch={vi.fn()}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query=""
        sort="title"
        view="grid"
      />,
    );
    const content = scope.querySelector(".collection-content.series-overview__content");

    expect(content?.getAttribute("data-surface-state")).toBe("empty");
    expect(content?.querySelector(":scope > .empty-state")).not.toBeNull();
    expect(seriesStyles).not.toContain(".series-overview > .empty-state");
  });

  it("preserves the Series search-empty recovery action", () => {
    const onClearSearch = vi.fn();
    const scope = mount(
      <SeriesOverview
        cardSize="medium"
        entries={deriveSeriesEntries(seriesBooks())}
        isLoading={false}
        onClearSearch={onClearSearch}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query="missing"
        sort="title"
        view="grid"
      />,
    );
    const content = scope.querySelector(".collection-content.series-overview__content");

    expect(content?.getAttribute("data-surface-state")).toBe("search-empty");
    expect(content?.textContent).toContain("No matching series");

    act(() => buttonWithText(scope, "Clear search").click());

    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it("keeps loading and empty series states semantically distinct", () => {
    const scope = mount(
      <SeriesOverview
        cardSize="medium"
        entries={[]}
        isLoading
        onClearSearch={vi.fn()}
        onOpen={vi.fn()}
        onQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query=""
        sort="title"
        view="grid"
      />,
    );
    const content = scope.querySelector(".collection-content.series-overview__content");

    expect(content?.getAttribute("data-surface-state")).toBe("loading");
    expect(content?.getAttribute("aria-busy")).toBe("true");
    expect(content?.querySelector('[role="status"]')).not.toBeNull();
    expect(content?.querySelector(".empty-state")).toBeNull();
  });

  it("renders ordered volumes, conservative hints, and continuation markers", () => {
    const entry = deriveSeriesEntries(seriesBooks())[0]!;
    const onRead = vi.fn();
    const scope = mount(<SeriesDetail entry={entry} onBack={vi.fn()} onRead={onRead} />);
    const volumeRows = Array.from(scope.querySelectorAll(".series-volume"));

    expect(
      volumeRows.map((row) => row.querySelector(".series-volume__title")?.textContent),
    ).toEqual(["The Beginning", "The Crossing", "The Return"]);
    expect(scope.textContent).toContain("Volume 3 may be missing");
    expect(
      scope.querySelector('[data-marker="current"]')?.parentElement?.parentElement?.textContent,
    ).toContain("The Crossing");
    expect(
      scope
        .querySelector('[data-marker="current"]')
        ?.closest("button")
        ?.getAttribute("aria-current"),
    ).toBe("true");
    expect(
      scope.querySelector('[data-marker="unread"]')?.parentElement?.parentElement?.textContent,
    ).toContain("The Return");
    expect(scope.textContent).toContain("Vol. 01");
    expect(seriesStyles).not.toContain(".series-volume[data-current]");
    expect(seriesStyles).not.toContain(".series-volume[data-unread]");
    expect(volumeRows.every((row) => row.querySelectorAll("button").length === 1)).toBe(true);

    const currentVolume = volumeRows[1]?.querySelector<HTMLButtonElement>(
      '.series-volume__open[aria-label="Continue The Crossing"]',
    );
    expect(currentVolume?.querySelector(".series-volume__action svg")).not.toBeNull();

    act(() => currentVolume?.click());
    expect(onRead.mock.calls.map(([book]) => book.id)).toEqual(["volume-2"]);

    onRead.mockClear();

    act(() => buttonWithText(scope, "Continue Series").click());

    expect(onRead.mock.calls.map(([book]) => book.id)).toEqual(["volume-2"]);
    expect(scope.textContent).not.toContain("Open next unread");
  });

  it("describes missing series actions without weakening current-volume state", () => {
    const books = seriesBooks().map((book) =>
      book.id === "volume-2" ? { ...book, isFileMissing: true } : book,
    );
    const entry = deriveSeriesEntries(books)[0]!;
    const onRead = vi.fn();
    const scope = mount(<SeriesDetail entry={entry} onBack={vi.fn()} onRead={onRead} />);
    const continueButton = buttonWithText(scope, "Continue Series");
    const currentVolume = scope.querySelector<HTMLButtonElement>(
      ".series-volume__open[aria-current='true']",
    )!;

    expect(continueButton.disabled).toBe(false);
    expect(continueButton.getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(continueButton.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("The EPUB file is missing.");
    expect(currentVolume.disabled).toBe(false);
    expect(currentVolume.getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(currentVolume.getAttribute("aria-describedby")!)?.textContent,
    ).toContain("Reading is unavailable");
    act(() => {
      currentVolume.focus();
      currentVolume.click();
    });
    expect(document.activeElement).toBe(currentVolume);
    expect(onRead).not.toHaveBeenCalled();
  });

  it("makes each series volume row a full-width interactive surface", () => {
    const openStyles = cssBlock(seriesStyles, ".series-volume__open");
    const hoverStyles = cssBlock(
      seriesStyles,
      '.series-volume__open:hover:not(:disabled):not([aria-disabled="true"]),\n.series-volume__open:focus-visible',
    );

    expect(openStyles).toContain("width: 100%;");
    expect(openStyles).toContain("cursor: pointer;");
    expect(hoverStyles).toContain("border-color: var(--line-strong);");
    expect(hoverStyles).toContain("background: var(--surface-raised);");
  });

  it("shows a recovery state for a stale series location", () => {
    const onBack = vi.fn();
    const scope = mount(<SeriesDetail onBack={onBack} onRead={vi.fn()} />);

    expect(scope.textContent).toContain("Series not found");
    act(() => buttonWithText(scope, "Back to Series").click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
