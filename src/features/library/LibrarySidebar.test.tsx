// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KnownArchive } from "../../types/archive";
import type { Folder } from "../../types/folder";
import type { LibrarySmartViewPreferences } from "../../types/library";
import { DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES } from "../../types/librarySmartViews";
import { WindowTitlebarAppActionsHost } from "../../components/WindowTitlebar";
import { TooltipProvider } from "../../components/Tooltip";
import { createFolderBrowserEntries } from "../folders/folderBrowserReadModel";
import { LibrarySidebar } from "./LibrarySidebar";
import { LibraryTitlebarComposition } from "./LibraryTitlebarComposition";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const activeArchive: KnownArchive = {
  id: "archive-books",
  displayName: "Books",
  rootPath: "D:\\Books",
  createdAt: "1",
  lastOpenedAt: "2",
};

const savedArchive: KnownArchive = {
  id: "archive-comics",
  displayName: "Comics",
  rootPath: "E:\\Comics",
  createdAt: "1",
  lastOpenedAt: "1",
};

const enabledSmartViews: LibrarySmartViewPreferences = {
  enabled: true,
  visible: [...DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES.visible],
};

function sidebarProps(
  folders: Folder[] = [],
  location: Parameters<typeof LibrarySidebar>[0]["location"] = { type: "library" },
  onLocationChange: Parameters<typeof LibrarySidebar>[0]["onLocationChange"] = vi.fn(),
  smartViewPreferences = enabledSmartViews,
): Parameters<typeof LibrarySidebar>[0] {
  return {
    activeArchive,
    archives: [activeArchive, savedArchive],
    collapsed: false,
    expandedContentRef: { current: null },
    folderEntries: createFolderBrowserEntries(
      folders,
      new Map(folders.map((folder, index) => [folder.id, index + 1])),
    ),
    folderSort: "name",
    location,
    smartViewPreferences,
    onCreateFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onFolderSortChange: vi.fn(),
    onLocationChange,
    onManageArchives: vi.fn(),
    onMoveFolder: vi.fn(),
    onOpenAbout: vi.fn(),
    onOpenSettings: vi.fn(),
    onRenameFolder: vi.fn(),
    onSwitchArchive: vi.fn(),
  };
}

function renderSidebar(
  folders: Folder[] = [],
  location: Parameters<typeof LibrarySidebar>[0]["location"] = { type: "library" },
  smartViewPreferences = enabledSmartViews,
) {
  return renderToStaticMarkup(
    <LibrarySidebar {...sidebarProps(folders, location, vi.fn(), smartViewPreferences)} />,
  );
}

function renderInteractiveSidebar(
  location: Parameters<typeof LibrarySidebar>[0]["location"] = { type: "library" },
  onLocationChange = vi.fn(),
  smartViewPreferences = enabledSmartViews,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <TooltipProvider>
        <LibrarySidebar {...sidebarProps([], location, onLocationChange, smartViewPreferences)} />
      </TooltipProvider>,
    );
  });

  return { container, onLocationChange, root };
}

function renderCollapsibleSidebar(folders: Folder[] = []) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  function Harness() {
    const [collapsed, setCollapsed] = useState(false);
    const expandedContentRef = useRef<HTMLDivElement>(null);

    return (
      <>
        <div className="window-titlebar">
          <WindowTitlebarAppActionsHost />
          <div data-tauri-drag-region />
        </div>
        <LibraryTitlebarComposition
          collapseAvailable
          collapsed={collapsed}
          expandedSidebarContentRef={expandedContentRef}
          onCollapsedChange={setCollapsed}
          onOpenQuickActions={vi.fn()}
          onRevealArchive={vi.fn()}
        />
        <LibrarySidebar
          {...sidebarProps(folders)}
          collapsed={collapsed}
          expandedContentRef={expandedContentRef}
        />
      </>
    );
  }

  act(() => {
    root.render(
      <TooltipProvider>
        <Harness />
      </TooltipProvider>,
    );
  });

  return { container, root };
}

function smartViewsDisclosure(container: HTMLElement): HTMLButtonElement {
  const disclosure = container.querySelector<HTMLButtonElement>(
    "button[aria-controls][aria-expanded]",
  );

  if (!disclosure) {
    throw new Error("Smart Views disclosure was not rendered.");
  }

  return disclosure;
}

let activeRoot: Root | null = null;

describe("LibrarySidebar", () => {
  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
    document.body.innerHTML = "";
  });

  it("names the complementary sidebar and its primary navigation in expanded and collapsed modes", () => {
    const expanded = renderSidebar();
    const collapsed = renderToStaticMarkup(
      <LibrarySidebar {...sidebarProps()} collapsed expandedContentRef={{ current: null }} />,
    );

    for (const markup of [expanded, collapsed]) {
      expect(markup).toContain('<aside aria-label="Library sidebar"');
      expect(markup).toContain('<nav class="sidebar__nav" aria-label="Library navigation"');
    }
  });

  it.each([
    ["Duplicates", { type: "duplicates" }],
    ["EPUB Issues", { type: "epub-issues" }],
  ] as const)("navigates to %s through the primary Library navigation", (label, location) => {
    const onLocationChange = vi.fn();
    const session = renderInteractiveSidebar(location, onLocationChange);
    activeRoot = session.root;
    const control = session.container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );

    expect(control?.getAttribute("aria-current")).toBe("page");
    act(() => control?.click());
    expect(onLocationChange).toHaveBeenCalledWith(location);
  });

  it("exposes only the effective Settings shortcut on the existing Settings control", () => {
    const markup = renderToStaticMarkup(
      <LibrarySidebar {...sidebarProps()} settingsAriaKeyShortcuts="Control+," />,
    );

    expect(markup).toContain('aria-label="Settings"');
    expect(markup).toContain('aria-keyshortcuts="Control+,"');
    expect(markup).not.toContain('aria-label="Quick Actions"');
  });

  it("keeps Quick Actions out of sidebar navigation and preserves footer ordering", () => {
    const markup = renderSidebar();

    expect(markup).not.toContain('aria-label="Quick Actions"');
    expect(markup).toContain('aria-label="Settings"');
    expect(markup.indexOf("archive-switcher")).toBeLessThan(markup.indexOf("About Archeion"));
    expect(markup.indexOf("About Archeion")).toBeLessThan(markup.indexOf('aria-label="Settings"'));
  });

  it("renders the collapse action in the window frame with the requested panel icon", () => {
    const session = renderCollapsibleSidebar();
    activeRoot = session.root;
    const control = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse sidebar"]',
    );

    expect(control?.title).toBe("");
    expect(
      document.getElementById(control?.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Collapse sidebar");
    expect(control?.closest(".window-titlebar__app-actions")).not.toBeNull();
    expect(control?.closest("[data-tauri-drag-region]")).toBeNull();
    expect(control?.querySelector(".library-titlebar-composition__sidebar-icon")).not.toBeNull();
    expect(control?.getAttribute("data-sidebar-direction")).toBe("collapse-left");
  });

  it("uses a ghost icon select for the shared sidebar Folder sort preference", () => {
    const onFolderSortChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <LibrarySidebar
          {...sidebarProps([
            {
              id: "folder-alpha",
              name: "Alpha",
              relativePath: "Alpha",
              parentId: null,
              parentPath: null,
              createdAt: "1",
              updatedAt: "1",
            },
          ])}
          onFolderSortChange={onFolderSortChange}
        />,
      );
    });

    const sort = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Sort sidebar folders"]',
    );
    expect(sort?.closest(".app-select--icon-only")).not.toBeNull();
    expect(sort?.querySelector(".app-select__trigger-icon")).not.toBeNull();
    expect(sort?.querySelector(".app-select__value")).toBeNull();

    act(() => sort?.click());
    const mostBooks = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("Most books"));
    act(() => mostBooks?.click());

    expect(onFolderSortChange).toHaveBeenCalledWith("most-books");

    const styles = readFileSync(resolve(process.cwd(), "src/styles/layout/app-shell.css"), "utf8");
    expect(styles).toMatch(
      /\.sidebar__folder-sort \.app-select__trigger\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;/s,
    );
    expect(styles).toMatch(
      /\.sidebar__folder-sort \.app-select__trigger:hover,[\s\S]*?\{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--surface-raised\);/s,
    );
  });

  it("orders the sidebar Folder tree with the shared Folder sort preference", () => {
    const folders: Folder[] = [
      {
        id: "folder-alpha",
        name: "Alpha",
        relativePath: "Alpha",
        parentId: null,
        parentPath: null,
        createdAt: "1",
        updatedAt: "1",
      },
      {
        id: "folder-zeta",
        name: "Zeta",
        relativePath: "Zeta",
        parentId: null,
        parentPath: null,
        createdAt: "1",
        updatedAt: "1",
      },
    ];
    const props = sidebarProps(folders);
    const markup = renderToStaticMarkup(<LibrarySidebar {...props} folderSort="most-books" />);

    expect(markup.indexOf(">Zeta</span>")).toBeLessThan(markup.indexOf(">Alpha</span>"));
  });

  it("keeps primary and footer destinations reachable in the collapsed rail", () => {
    const session = renderCollapsibleSidebar([
      {
        id: "folder-black-saint",
        name: "Black Saint",
        relativePath: "Black Saint",
        parentId: null,
        parentPath: null,
        createdAt: "1",
        updatedAt: "1",
      },
    ]);
    activeRoot = session.root;

    act(() => {
      session.container
        .querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')
        ?.click();
    });

    const sidebar = session.container.querySelector(".sidebar");
    const expand = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand sidebar"]',
    );

    expect(sidebar?.getAttribute("data-collapsed")).toBe("true");
    expect(expand?.title).toBe("");
    expect(
      document.getElementById(expand?.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Expand sidebar");
    expect(expand?.getAttribute("data-sidebar-direction")).toBe("expand-right");
    for (const destination of ["Library", "Series", "Favorites", "Folders"]) {
      expect(
        session.container.querySelector(`.sidebar__nav [aria-label="${destination}"]`),
      ).not.toBeNull();
    }
    expect(session.container.textContent).not.toContain("Smart views");
    expect(session.container.textContent).not.toContain("Black Saint");
    expect(session.container.querySelector(".sidebar__folder-scroll")).toBeNull();
    expect(session.container.querySelector('[aria-label="Current archive: Books"]')).not.toBeNull();
    for (const label of ["About Archeion", "Settings"]) {
      const control = session.container.querySelector(`[aria-label="${label}"]`);
      expect(control?.getAttribute("title")).toBeNull();
      expect(
        document.getElementById(control?.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toBe(label);
    }
  });

  it("moves focus to the frame control before hiding focused sidebar content", () => {
    const session = renderCollapsibleSidebar();
    activeRoot = session.root;
    const createFolder = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Create folder"]',
    );
    const collapse = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse sidebar"]',
    );

    act(() => createFolder?.focus());
    expect(document.activeElement).toBe(createFolder);

    act(() => collapse?.click());

    const expand = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand sidebar"]',
    );
    expect(document.activeElement).toBe(expand);

    act(() => expand?.click());

    expect(document.activeElement).toBe(
      session.container.querySelector('button[aria-label="Collapse sidebar"]'),
    );
  });

  it("keeps titlebar composition out of the sidebar and toolbar owners", () => {
    const sidebarSource = readFileSync(
      resolve(process.cwd(), "src/features/library/LibrarySidebar.tsx"),
      "utf8",
    );
    const titlebarCompositionSource = readFileSync(
      resolve(process.cwd(), "src/features/library/LibraryTitlebarComposition.tsx"),
      "utf8",
    );
    const toolbarSource = readFileSync(
      resolve(process.cwd(), "src/features/library/LibraryToolbar.tsx"),
      "utf8",
    );

    expect(sidebarSource).not.toContain("onOpenQuickActions");
    expect(sidebarSource).not.toContain("quickActionsAriaKeyShortcuts");
    expect(sidebarSource).not.toContain("Zap");
    expect(titlebarCompositionSource).toContain("onOpenQuickActions");
    expect(titlebarCompositionSource).toContain("quickActionsAriaKeyShortcuts");
    expect(titlebarCompositionSource).toContain("Zap");
    expect(toolbarSource).not.toContain("Quick Actions");
  });

  it("keeps the archive switcher focused on known archives and management", () => {
    const markup = renderSidebar();
    const archiveRows = markup.match(
      /<button class="menu-item menu-item--no-icon archive-switcher__archive"[\s\S]*?<\/button>/g,
    );

    expect(markup).toContain("Books");
    expect(markup).toContain("Comics");
    expect(markup).toContain("Manage archives");
    expect(markup).not.toContain("Manage vaults");
    expect(markup).not.toContain("Open archive");
    expect(markup).not.toContain("Open folder as archive");
    expect(markup).not.toContain("Create empty archive");
    expect(markup).not.toContain("E:\\Comics");
    expect(markup.match(/role="separator"/g)).toHaveLength(1);
    expect(archiveRows).toHaveLength(1);
    expect(archiveRows?.[0]).not.toContain("<svg");
    expect(markup).toContain("archive-switcher__current menu-item menu-item--trailing-icon");
    expect(markup).toContain("archive-switcher__menu menu-popover");
    expect(markup).toContain("menu-trigger menu-trigger--disclosure");
  });

  it("keeps the folder heading outside the scrollable folder list", () => {
    const markup = renderSidebar([
      {
        id: "folder-black-saint",
        name: "Black Saint",
        relativePath: "Black Saint",
        parentId: null,
        parentPath: null,
        createdAt: "1",
        updatedAt: "1",
      },
    ]);

    expect(markup).toContain('class="sidebar__section-heading"');
    expect(markup).toContain('class="sidebar__folder-scroll"');
    expect(markup).toMatch(
      /sidebar__section-heading[\s\S]*?Create folder[\s\S]*?sidebar__folder-scroll/,
    );
  });

  it("exposes each potentially truncated folder name without a native title", () => {
    const folderName = "Come Barefoot Tomorrow Through the Long Summer";
    const session = renderCollapsibleSidebar([
      {
        id: "folder-long-name",
        name: folderName,
        relativePath: folderName,
        parentId: null,
        parentPath: null,
        createdAt: "1",
        updatedAt: "1",
      },
    ]);
    activeRoot = session.root;
    const folder = session.container.querySelector<HTMLButtonElement>(".folder-tree__select");

    expect(folder?.getAttribute("title")).toBeNull();
    expect(
      document.getElementById(folder?.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe(folderName);
  });

  it("places the folder scrollbar at the sidebar edge without moving the section heading", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles/layout/app-shell.css"), "utf8");

    expect(styles).toMatch(/\.sidebar__section\s*\{[^}]*padding-inline-end:\s*4px;[^}]*\}/s);
    expect(styles).toMatch(
      /\.sidebar__folder-scroll\s*\{[^}]*scrollbar-gutter:\s*stable;[^}]*padding-inline-end:\s*4px;[^}]*margin-inline-end:\s*-4px;[^}]*\}/s,
    );
    expect(styles).not.toMatch(
      /\.sidebar__(?:section|folder-scroll)\s*\{[^}]*(?:padding|margin)-right:/s,
    );
  });

  it("shows Series as a first-class navigation location", () => {
    const markup = renderSidebar([], { type: "series-detail", seriesKey: "star saga" });

    expect(markup).toContain("Series");
    expect(markup).toMatch(/aria-current="page"[\s\S]*?>Series</);
  });

  it("omits the complete Smart Views section when disabled", () => {
    const markup = renderSidebar(
      [],
      { type: "library" },
      {
        enabled: false,
        visible: ["unread", "completed"],
      },
    );

    expect(markup).not.toContain("Smart views");
    expect(markup).not.toContain("sidebar__smart-views");
  });

  it("renders only selected Smart Views in canonical order", () => {
    const session = renderInteractiveSidebar({ type: "library" }, vi.fn(), {
      enabled: true,
      visible: ["needs-cover", "unread"],
    });
    activeRoot = session.root;

    act(() => smartViewsDisclosure(session.container).click());

    expect(session.container.textContent).toMatch(/Unread[\s\S]*Needs cover/);
    expect(session.container.textContent).not.toContain("In progress");
    expect(session.container.textContent).not.toContain("Completed");
  });

  it("collapses Smart Views initially and supports pointer and keyboard-compatible activation", () => {
    const session = renderInteractiveSidebar();
    activeRoot = session.root;
    const disclosure = smartViewsDisclosure(session.container);
    const contentId = disclosure.getAttribute("aria-controls");

    const content = session.container.querySelector<HTMLElement>(`#${contentId}`);

    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.tagName).toBe("BUTTON");
    expect(contentId).toBeTruthy();
    expect(content?.hidden).toBe(true);

    act(() => {
      disclosure.focus();
      disclosure.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });

    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(content?.hidden).toBe(false);
    expect(content?.textContent).toContain("Unread");

    act(() => disclosure.click());

    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(content?.hidden).toBe(true);
  });

  it("indicates the active smart view compactly while collapsed", () => {
    const session = renderInteractiveSidebar({ type: "smart-view", smartView: "completed" });
    activeRoot = session.root;
    const disclosure = smartViewsDisclosure(session.container);

    expect(disclosure.textContent).toContain("Smart views");
    expect(disclosure.textContent).toContain("· Completed");
    const activeRow = session.container.querySelector<HTMLButtonElement>(
      'button[aria-current="page"]',
    );

    expect(activeRow?.textContent).toContain("Completed");
    expect(activeRow?.closest(".sidebar__smart-views-list")?.hasAttribute("hidden")).toBe(true);
    expect(disclosure.textContent).not.toContain("2");
  });

  it("shows fixed smart-view rows without counts and preserves metadata guidance", () => {
    const session = renderInteractiveSidebar({ type: "smart-view", smartView: "completed" });
    activeRoot = session.root;

    act(() => smartViewsDisclosure(session.container).click());

    const markup = session.container.innerHTML;
    const needsMetadata = Array.from(session.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Needs metadata"),
    );

    expect(markup).toContain(">Unread</span>");
    expect(markup).toContain(">In progress</span>");
    expect(markup).toMatch(/aria-current="page"[\s\S]*?>Completed<\/span>/);
    expect(markup).toContain(">Needs metadata</span>");
    expect(markup).toContain(">Needs cover</span>");
    expect(markup).not.toContain("nav-item__count");
    expect(needsMetadata?.getAttribute("title")).toBeNull();
    expect(
      session.container.querySelector(
        `#${needsMetadata?.getAttribute("aria-describedby") ?? "missing"}`,
      )?.textContent,
    ).toContain("Missing title or author");
  });

  it("keeps Smart Views expanded after navigation and preserves existing routes", () => {
    const onLocationChange = vi.fn();
    const session = renderInteractiveSidebar({ type: "library" }, onLocationChange);
    activeRoot = session.root;
    const disclosure = smartViewsDisclosure(session.container);

    act(() => disclosure.click());
    const completed = Array.from(session.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Completed",
    );
    const inProgress = Array.from(session.container.querySelectorAll("button")).find(
      (button) => button.textContent === "In progress",
    );

    act(() => completed?.click());
    expect(onLocationChange).toHaveBeenCalledWith({
      type: "smart-view",
      smartView: "completed",
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(session.container.textContent).toContain("Needs cover");

    act(() => inProgress?.click());
    expect(onLocationChange).toHaveBeenCalledWith({ type: "continue" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the existing Continue location active as the In progress smart view", () => {
    const session = renderInteractiveSidebar({ type: "continue" });
    activeRoot = session.root;
    const disclosure = smartViewsDisclosure(session.container);

    expect(disclosure.textContent).toContain("· In progress");

    act(() => disclosure.click());

    const activeRow = session.container.querySelector<HTMLButtonElement>(
      'button[aria-current="page"]',
    );
    expect(activeRow?.textContent).toContain("In progress");
    expect(session.container.textContent).not.toContain("Continue");
  });
});
