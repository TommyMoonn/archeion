// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Folder } from "../../types/folder";
import { FolderBrowser } from "./FolderBrowser";
import { createFolderBrowserEntries } from "./folderBrowserReadModel";

function entries(folders: readonly Folder[], counts = new Map<string, number>()) {
  return createFolderBrowserEntries(folders, counts);
}

describe("FolderBrowser", () => {
  it("uses the shared accessible icon-only collection view control", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        cardSize="medium"
        entries={[]}
        isLoading={false}
        onOpen={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="list"
      />,
    );

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Folder view"');
    expect(markup).toContain('aria-label="Cards"');
    expect(markup).toContain('aria-label="List"');
    expect(markup.indexOf('aria-label="Cards"')).toBeLessThan(markup.indexOf('aria-label="List"'));
    expect(markup.match(/role="radio"/g)).toHaveLength(2);
    expect(markup).not.toContain("folder-view-toggle");
  });

  it("exposes the result count and primary action", () => {
    const folders: Folder[] = [
      {
        id: "folder-fiction",
        name: "Fiction",
        relativePath: "Fiction",
        parentId: null,
        parentPath: null,
        createdAt: "1",
        updatedAt: "1",
      },
    ];
    const markup = renderToStaticMarkup(
      <FolderBrowser
        cardSize="medium"
        canManageFolders
        entries={entries(folders)}
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

    expect(markup).toContain('aria-label="1 folder shown"');
    expect(markup).toContain("1 folder");
    expect(markup).toContain("Add folder");
  });

  it("marks Cards selected when the controlled folder view is cards", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        cardSize="medium"
        entries={[]}
        isLoading={false}
        onOpen={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="cards"
      />,
    );

    expect(markup).toContain('aria-label="Cards"');
    const document = new DOMParser().parseFromString(markup, "text/html");
    expect(
      document.querySelector('[role="radio"][aria-label="Cards"]')?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("keeps true-empty folders in the shared collection state geometry", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        cardSize="medium"
        canManageFolders
        entries={[]}
        isLoading={false}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="list"
      />,
    );

    expect(markup).toContain('data-surface-state="empty"');
    expect(markup).toContain("No folders yet");
    expect(markup.match(/Add folder/g)).toHaveLength(1);
    const emptyStateMarkup = markup.slice(markup.indexOf('data-slot="empty"'));
    expect(emptyStateMarkup).not.toContain("Add folder");
  });

  it("disables native autofill on the folder search field", () => {
    const markup = renderToStaticMarkup(
      <FolderBrowser
        cardSize="medium"
        entries={[]}
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
    expect(markup).toContain('aria-labelledby="folder-browser-title"');
    expect(markup).toContain('<h1 id="folder-browser-title">Folders</h1>');
    expect(markup).toContain('aria-label="Folder search"');
    expect(markup).toContain('role="search"');
  });

  it("marks folder rows and cards as explicit import targets", () => {
    const folders: Folder[] = [
      {
        id: "folder-fiction",
        name: "Fiction",
        relativePath: "Fiction",
        parentId: null,
        parentPath: null,
        createdAt: "1",
        updatedAt: "1",
      },
    ];
    const markup = renderToStaticMarkup(
      <FolderBrowser
        entries={entries(folders)}
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

  it("keeps long folder content and its essential actions available", () => {
    const name =
      "Collected translations and archival editions with exceptionally descriptive names";
    const relativePath = `Reference library/International editions/${name}`;
    const folders: Folder[] = [
      {
        id: "folder-long-content",
        name,
        relativePath,
        parentId: null,
        parentPath: "Reference library/International editions",
        createdAt: "1",
        updatedAt: "1",
      },
    ];
    const markup = renderToStaticMarkup(
      <FolderBrowser
        cardSize="medium"
        canManageFolders
        entries={entries(folders)}
        isLoading={false}
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

    expect(markup).toContain(name);
    expect(markup).toContain(relativePath);
    expect(markup).toContain(`aria-label="Rename ${name}"`);
    expect(markup).toContain(`aria-label="Actions for ${name}"`);
  });
});
