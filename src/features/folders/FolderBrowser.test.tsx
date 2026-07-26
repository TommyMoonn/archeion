import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FolderBrowser } from "./FolderBrowser";

describe("FolderBrowser", () => {
  it("uses the shared accessible icon-only collection view control", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        bookCounts={new Map()}
        cardSize="medium"
        folders={[]}
        isLoading={false}
        onOpen={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="list"
      />,
    );

    expect(markup).toContain("segmented-control--icon-only");
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Folder view"');
    expect(markup).toContain('aria-label="Cards"');
    expect(markup).toContain('aria-label="List"');
    expect(markup.indexOf('aria-label="Cards"')).toBeLessThan(markup.indexOf('aria-label="List"'));
    expect(markup).not.toContain("folder-view-toggle");
  });

  it("keeps the result count on row two and matches the rectangular primary action", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        bookCounts={new Map()}
        cardSize="medium"
        canManageFolders
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
        isLoading={false}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="list"
      />,
    );

    expect(markup).toContain('class="library-controls folder-browser__controls"');
    expect(markup).toContain('aria-label="1 folder shown"');
    expect(markup).toContain("1 folder");
    expect(markup).toContain("button--standard folder-browser__add-button");
    expect(markup).toContain("Add Folder");
  });

  it("marks Cards selected when the controlled folder view is cards", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        bookCounts={new Map()}
        cardSize="medium"
        folders={[]}
        isLoading={false}
        onOpen={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="cards"
      />,
    );

    expect(markup).toContain('aria-label="Cards"');
    expect(markup).toContain('aria-checked="true" aria-label="Cards"');
  });

  it("keeps true-empty folders in the shared collection state geometry", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        bookCounts={new Map()}
        cardSize="medium"
        canManageFolders
        folders={[]}
        isLoading={false}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="list"
      />,
    );

    expect(markup).toContain(
      'class="collection-content folder-browser__content" data-surface-state="empty"',
    );
    expect(markup).toContain("No folders");
    expect(markup).toContain("Add Folder");
  });

  it("disables native autofill on the folder search field", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        bookCounts={new Map()}
        cardSize="medium"
        folders={[]}
        isLoading={false}
        onOpen={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="list"
      />,
    );

    expect(markup).toContain('type="search"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('autoCorrect="off"');
    expect(markup).toContain('autoCapitalize="none"');
    expect(markup).toContain('name="archeion-folder-search"');
    expect(markup).toContain("input-shell--standard");
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
        isLoading={false}
        activeImportDropTargetId="folder-browser:folder-fiction"
        cardSize="medium"
        onOpen={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="list"
      />,
    );

    expect(markup).toContain('data-import-drop-target="true"');
    expect(markup).toContain('data-import-drop-destination="Fiction"');
    expect(markup).toContain('data-import-drop-active="true"');
  });
});
