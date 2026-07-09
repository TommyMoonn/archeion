import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FolderBrowser } from "./FolderBrowser";

describe("FolderBrowser", () => {
  it("disables native autofill on the folder search field", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser bookCounts={new Map()} folders={[]} onOpen={vi.fn()} />,
    );

    expect(markup).toContain('type="search"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('autoCorrect="off"');
    expect(markup).toContain('autoCapitalize="none"');
    expect(markup).toContain('name="archeion-folder-search"');
    expect(markup).toContain('spellCheck="false"');
  });
});
