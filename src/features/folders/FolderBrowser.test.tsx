import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FolderBrowser } from "./FolderBrowser";

describe("FolderBrowser", () => {
  it("uses the shared accessible icon-only collection view control", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser bookCounts={new Map()} folders={[]} onOpen={vi.fn()} />,
    );

    expect(markup).toContain("segmented-control--icon-only");
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Folder view"');
    expect(markup).toContain('aria-label="List"');
    expect(markup).toContain('aria-label="Cards"');
    expect(markup).not.toContain("folder-view-toggle");
  });

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

  it("marks folder rows and cards as explicit import targets", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        bookCounts={new Map()}
        folders={[
          {
            id: "folder-fiction",
            name: "Fiction",
            relativePath: "Fiction",
            parentId: null,
            parentPath: null,
            createdAt: "1",
            updatedAt: "1",
          },
        ]}
        activeImportDropTargetId="folder-browser:folder-fiction"
        onOpen={vi.fn()}
      />,
    );

    expect(markup).toContain('data-import-drop-target="true"');
    expect(markup).toContain('data-import-drop-destination="Fiction"');
    expect(markup).toContain('data-import-drop-active="true"');
  });
});
