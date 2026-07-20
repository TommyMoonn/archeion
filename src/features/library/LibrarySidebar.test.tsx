// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KnownArchive } from "../../types/archive";
import type { Folder } from "../../types/folder";
import type { LibrarySmartViewPreferences } from "../../types/library";
import { DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES } from "../../types/librarySmartViews";
import { LibrarySidebar } from "./LibrarySidebar";

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

const defaultSmartViewCounts: Parameters<typeof LibrarySidebar>[0]["smartViewCounts"] = {
  unread: 0,
  "in-progress": 0,
  completed: 0,
  "needs-metadata": 0,
  "needs-cover": 0,
};
const enabledSmartViews: LibrarySmartViewPreferences = {
  enabled: true,
  visible: [...DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES.visible],
};

function sidebarProps(
  folders: Folder[] = [],
  location: Parameters<typeof LibrarySidebar>[0]["location"] = { type: "library" },
  smartViewCounts = defaultSmartViewCounts,
  onLocationChange: Parameters<typeof LibrarySidebar>[0]["onLocationChange"] = vi.fn(),
  smartViewPreferences = enabledSmartViews,
): Parameters<typeof LibrarySidebar>[0] {
  return {
    activeArchive,
    archives: [activeArchive, savedArchive],
    bookCount: 0,
    favoriteCount: 0,
    folders,
    location,
    seriesCount: 3,
    smartViewCounts,
    smartViewPreferences,
    onCreateFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
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
  smartViewCounts = defaultSmartViewCounts,
  smartViewPreferences = enabledSmartViews,
) {
  return renderToStaticMarkup(
    <LibrarySidebar
      {...sidebarProps(folders, location, smartViewCounts, vi.fn(), smartViewPreferences)}
    />,
  );
}

function renderInteractiveSidebar(
  location: Parameters<typeof LibrarySidebar>[0]["location"] = { type: "library" },
  smartViewCounts = defaultSmartViewCounts,
  onLocationChange = vi.fn(),
  smartViewPreferences = enabledSmartViews,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <LibrarySidebar
        {...sidebarProps([], location, smartViewCounts, onLocationChange, smartViewPreferences)}
      />,
    );
  });

  return { container, onLocationChange, root };
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

  it("exposes only the effective Settings shortcut on the existing Settings control", () => {
    const markup = renderToStaticMarkup(
      <LibrarySidebar {...sidebarProps()} settingsAriaKeyShortcuts="Control+," />,
    );

    expect(markup).toContain('aria-label="Settings"');
    expect(markup).toContain('aria-keyshortcuts="Control+,"');
    expect(markup).not.toContain('aria-label="Quick Actions"');
  });

  it("keeps Quick Actions out of the library UI and preserves footer ordering", () => {
    const markup = renderSidebar();

    expect(markup).not.toContain('aria-label="Quick Actions"');
    expect(markup).toContain('aria-label="Settings"');
    expect(markup.indexOf("archive-switcher")).toBeLessThan(markup.indexOf("About Archeion"));
    expect(markup.indexOf("About Archeion")).toBeLessThan(markup.indexOf('aria-label="Settings"'));
  });

  it("removes the obsolete Quick Actions sidebar API without adding a toolbar replacement", () => {
    const sidebarSource = readFileSync(
      resolve(process.cwd(), "src/features/library/LibrarySidebar.tsx"),
      "utf8",
    );
    const pageSource = readFileSync(
      resolve(process.cwd(), "src/features/library/LibraryPage.tsx"),
      "utf8",
    );
    const toolbarSource = readFileSync(
      resolve(process.cwd(), "src/features/library/LibraryToolbar.tsx"),
      "utf8",
    );

    for (const source of [sidebarSource, pageSource]) {
      expect(source).not.toContain("onOpenQuickActions");
      expect(source).not.toContain("quickActionsAriaKeyShortcuts");
    }
    expect(sidebarSource).not.toContain("Lightning");
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

  it("exposes each truncated folder name through its native hover title", () => {
    const folderName = "Come Barefoot Tomorrow Through the Long Summer";
    const markup = renderSidebar([
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

    expect(markup).toContain(`title="${folderName}"`);
  });

  it("places the folder scrollbar at the sidebar edge without moving the section heading", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles/layout/app-shell.css"), "utf8");

    expect(styles).toMatch(/\.sidebar__section\s*\{[^}]*padding-right:\s*4px;[^}]*\}/s);
    expect(styles).toMatch(
      /\.sidebar__folder-scroll\s*\{[^}]*scrollbar-gutter:\s*stable;[^}]*padding-right:\s*4px;[^}]*margin-right:\s*-4px;[^}]*\}/s,
    );
  });

  it("shows Series as a first-class navigation location", () => {
    const markup = renderSidebar([], { type: "series-detail", seriesKey: "star saga" });

    expect(markup).toContain("Series");
    expect(markup).toMatch(/aria-current="page"[\s\S]*?>Series<[\s\S]*?>3</);
  });

  it("omits the complete Smart Views section when disabled", () => {
    const markup = renderSidebar([], { type: "library" }, defaultSmartViewCounts, {
      enabled: false,
      visible: ["unread", "completed"],
    });

    expect(markup).not.toContain("Smart views");
    expect(markup).not.toContain("sidebar__smart-views");
  });

  it("renders only selected Smart Views in canonical order", () => {
    const session = renderInteractiveSidebar({ type: "library" }, defaultSmartViewCounts, vi.fn(), {
      enabled: true,
      visible: ["needs-cover", "unread"],
    });
    activeRoot = session.root;

    act(() => smartViewsDisclosure(session.container).click());

    expect(session.container.textContent).toMatch(/Unread0[\s\S]*Needs cover0/);
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
    const session = renderInteractiveSidebar(
      { type: "smart-view", smartView: "completed" },
      {
        unread: 4,
        "in-progress": 3,
        completed: 2,
        "needs-metadata": 1,
        "needs-cover": 5,
      },
    );
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

  it("shows fixed smart-view rows, counts, and metadata guidance when expanded", () => {
    const session = renderInteractiveSidebar(
      { type: "smart-view", smartView: "completed" },
      {
        unread: 4,
        "in-progress": 3,
        completed: 2,
        "needs-metadata": 1,
        "needs-cover": 5,
      },
    );
    activeRoot = session.root;

    act(() => smartViewsDisclosure(session.container).click());

    const markup = session.container.innerHTML;
    const needsMetadata = Array.from(session.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Needs metadata"),
    );

    expect(markup).toMatch(/>Unread<[\s\S]*?>4</);
    expect(markup).toMatch(/>In progress<[\s\S]*?>3</);
    expect(markup).toMatch(/aria-current="page"[\s\S]*?>Completed<[\s\S]*?>2</);
    expect(markup).toMatch(/>Needs metadata<[\s\S]*?>1</);
    expect(markup).toMatch(/>Needs cover<[\s\S]*?>5</);
    expect(needsMetadata?.getAttribute("title")).toBe("Missing title or author");
    expect(
      session.container.querySelector(
        `#${needsMetadata?.getAttribute("aria-describedby") ?? "missing"}`,
      )?.textContent,
    ).toContain("Missing title or author");
  });

  it("keeps Smart Views expanded after navigation and preserves existing routes", () => {
    const onLocationChange = vi.fn();
    const session = renderInteractiveSidebar(
      { type: "library" },
      defaultSmartViewCounts,
      onLocationChange,
    );
    activeRoot = session.root;
    const disclosure = smartViewsDisclosure(session.container);

    act(() => disclosure.click());
    const completed = Array.from(session.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Completed0",
    );
    const inProgress = Array.from(session.container.querySelectorAll("button")).find(
      (button) => button.textContent === "In progress0",
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
