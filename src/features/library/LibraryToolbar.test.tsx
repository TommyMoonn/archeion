// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibraryToolbar } from "./LibraryToolbar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../archive/RescanArchiveButton", () => ({
  RescanArchiveButton: () => null,
}));

function renderToolbar() {
  return renderToStaticMarkup(
    <LibraryToolbar
      isImporting={false}
      onClearSearch={vi.fn()}
      onOpenAddEpub={vi.fn()}
      onQueryChange={vi.fn()}
      onRescanError={vi.fn()}
      onSortChange={vi.fn()}
      onViewChange={vi.fn()}
      query=""
      sort="title"
      title="Library"
      view="grid"
    />,
  );
}

function renderInteractiveToolbar({
  onClearSearch = vi.fn(),
  onQueryChange = vi.fn(),
}: {
  onClearSearch?: () => void;
  onQueryChange?: (query: string) => void;
}) {
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(
      <LibraryToolbar
        isImporting={false}
        onClearSearch={onClearSearch}
        onOpenAddEpub={vi.fn()}
        onQueryChange={onQueryChange}
        onRescanError={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        query="Dune"
        sort="title"
        title="Library"
        view="grid"
      />,
    );
  });

  return { container, root };
}

let activeRoot: Root | null = null;

describe("LibraryToolbar", () => {
  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
  });

  it("disables native autofill on the library search field", () => {
    const markup = renderToolbar();

    expect(markup).toContain('type="search"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('autoCorrect="off"');
    expect(markup).toContain('autoCapitalize="none"');
    expect(markup).toContain('name="archeion-library-search"');
    expect(markup).toContain('spellCheck="false"');
  });

  it("keeps search clearing separate from search typing", () => {
    const onClearSearch = vi.fn();
    const onQueryChange = vi.fn();
    const session = renderInteractiveToolbar({ onClearSearch, onQueryChange });
    activeRoot = session.root;

    const clearButton = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear search"]',
    );

    expect(clearButton).not.toBeNull();
    act(() => clearButton?.click());

    expect(onClearSearch).toHaveBeenCalledTimes(1);
    expect(onQueryChange).not.toHaveBeenCalled();
  });
});
