// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Folder } from "../../types/folder";
import { FolderBrowser } from "./FolderBrowser";
import { createFolderBrowserEntries } from "./folderBrowserReadModel";

const folders: Folder[] = [
  {
    id: "folder-a",
    name: "Alpha",
    relativePath: "Root/Alpha",
    parentId: "root",
    parentPath: "Root",
    createdAt: "1",
    updatedAt: "1",
  },
];

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(overrides: Partial<React.ComponentProps<typeof FolderBrowser>> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props: React.ComponentProps<typeof FolderBrowser> = {
    cardSize: "small",
    entries: createFolderBrowserEntries(folders, new Map([["folder-a", 3]])),
    isLoading: false,
    onOpen: vi.fn(),
    onSortChange: vi.fn(),
    onViewChange: vi.fn(),
    sort: "name",
    view: "cards",
    ...overrides,
  };
  act(() => root?.render(<FolderBrowser {...props} />));
  return { container, props };
}

describe("FolderBrowser display controls", () => {
  it("exposes the persisted sort and view callbacks", () => {
    const onSortChange = vi.fn();
    const onViewChange = vi.fn();
    const { container } = mount({ onSortChange, onViewChange });

    const sort = container.querySelector<HTMLButtonElement>('[aria-label="Sort folders"]');
    const list = container.querySelector<HTMLButtonElement>('[role="radio"][aria-label="List"]');
    act(() => sort?.click());
    const mostBooks = Array.from(container.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes("Most books"),
    );
    act(() => mostBooks?.click());
    act(() => list?.click());

    expect(onSortChange).toHaveBeenCalledWith("most-books");
    expect(onViewChange).toHaveBeenCalledWith("list");
  });

  it("scopes card size to the folder result surface", () => {
    const { container } = mount();
    expect(
      container.querySelector(".folder-browser__items")?.getAttribute("data-folder-card-size"),
    ).toBe("small");
  });

  it("preserves the search-empty recovery action", () => {
    const { container } = mount();
    const search = container.querySelector<HTMLInputElement>(
      'input[name="archeion-folder-search"]',
    );
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    act(() => {
      valueSetter?.call(search, "missing");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(
      container.querySelector(".folder-browser__content")?.getAttribute("data-surface-state"),
    ).toBe("search-empty");
    expect(container.textContent).toContain("No folders found");

    const clear = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Clear search",
    );
    act(() => clear?.click());

    expect(
      container.querySelector(".folder-browser__content")?.getAttribute("data-surface-state"),
    ).toBe("results");
    expect(container.querySelector(".folder-browser__open")).not.toBeNull();
  });
});
