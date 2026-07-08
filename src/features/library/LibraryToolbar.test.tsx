import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LibraryToolbar } from "./LibraryToolbar";

vi.mock("../archive/RescanArchiveButton", () => ({
  RescanArchiveButton: () => null,
}));

function renderToolbar() {
  return renderToStaticMarkup(
    <LibraryToolbar
      isImporting={false}
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

describe("LibraryToolbar", () => {
  it("disables native autofill on the library search field", () => {
    const markup = renderToolbar();

    expect(markup).toContain('type="search"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('autoCorrect="off"');
    expect(markup).toContain('autoCapitalize="none"');
    expect(markup).toContain('name="archeion-library-search"');
    expect(markup).toContain('spellCheck="false"');
  });
});
