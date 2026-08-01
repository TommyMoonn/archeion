// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusPresentationRuntime } from "../../app/inputModality";
import type { Folder } from "../../types/folder";
import { FolderBrowser } from "./FolderBrowser";
import { createFolderBrowserEntries } from "./folderBrowserReadModel";
import { FolderTree } from "./FolderTree";

const folder: Folder = {
  createdAt: "1",
  id: "folder-1",
  name: "Fiction",
  parentId: null,
  parentPath: null,
  relativePath: "Fiction",
  updatedAt: "1",
};

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;
let stopFocusPresentation: (() => void) | null = null;

beforeEach(() => {
  stopFocusPresentation = focusPresentationRuntime.start(document);
});

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
  container = null;
  stopFocusPresentation?.();
  stopFocusPresentation = null;
});

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

function menuLabels(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
    (item) => item.textContent?.trim() ?? "",
  );
}

describe("folder contextual invocation", () => {
  it("opens FolderBrowser actions at the pointer without navigating and matches overflow", () => {
    const onOpen = vi.fn();
    const view = mount(
      <FolderBrowser
        canManageFolders
        canRevealFolders
        cardSize="medium"
        entries={createFolderBrowserEntries([folder], new Map([[folder.id, 2]]))}
        isLoading={false}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onOpen={onOpen}
        onRename={vi.fn()}
        onReveal={vi.fn()}
        onSortChange={vi.fn()}
        onViewChange={vi.fn()}
        sort="name"
        view="cards"
      />,
    );
    const item = view.querySelector<HTMLElement>(".folder-browser__item");

    act(() => {
      item?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 80, clientY: 64 }),
      );
    });

    const pointerLabels = menuLabels();
    expect(pointerLabels).toEqual(["Move folder", "Reveal folder", "Delete folder"]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(item?.getAttribute("data-context-menu-open")).toBe("true");
    expect(document.documentElement.dataset.focusPresentation).toBe("pointer");

    act(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    act(() =>
      view
        .querySelector<HTMLButtonElement>('[aria-label="Actions for Fiction"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(menuLabels()).toEqual(pointerLabels);
  });

  it("opens FolderTree actions from both keyboard context keys without selecting", () => {
    const onSelect = vi.fn();
    const view = mount(
      <FolderTree
        folders={[folder]}
        location={{ type: "library" }}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRename={vi.fn()}
        onReveal={vi.fn()}
        onSelect={onSelect}
        showReveal
      />,
    );
    const primary = view.querySelector<HTMLButtonElement>(".folder-tree__select");
    primary?.focus();

    act(() => {
      primary?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true }),
      );
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toContain("Rename folder");
    expect(menuLabels()).toEqual([
      "Rename folder",
      "Move folder",
      "Reveal folder",
      "Delete folder",
    ]);
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-navigation");

    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    expect(document.activeElement).toBe(primary);

    act(() => {
      primary?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu" }));
    });
    expect(document.activeElement?.textContent).toContain("Rename folder");
  });

  it("promotes owned FolderTree directional focus movement to keyboard navigation", () => {
    const secondFolder: Folder = {
      ...folder,
      id: "folder-2",
      name: "Nonfiction",
      relativePath: "Nonfiction",
    };
    const view = mount(
      <FolderTree
        folders={[folder, secondFolder]}
        location={{ type: "library" }}
        onDelete={vi.fn()}
        onMove={vi.fn()}
        onRename={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    const items = view.querySelectorAll<HTMLButtonElement>(".folder-tree__select");
    items[0]?.focus();

    act(() => {
      items[0]?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowDown",
        }),
      );
    });

    expect(document.activeElement).toBe(items[1]);
    expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-navigation");
  });
});
