// @vitest-environment happy-dom

import { activateSelectOption } from "../../test/activateSelectOption";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KnownArchive } from "../../types/archive";
import type { Folder } from "../../types/folder";
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

function sidebarProps(
  folders: Folder[] = [],
  location: Parameters<typeof LibrarySidebar>[0]["location"] = { type: "library" },
  onLocationChange: Parameters<typeof LibrarySidebar>[0]["onLocationChange"] = vi.fn(),
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
    onCreateFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onFolderSortChange: vi.fn(),
    onLocationChange,
    onManageArchives: vi.fn(),
    onRevealArchive: vi.fn(),
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
) {
  return renderToStaticMarkup(<LibrarySidebar {...sidebarProps(folders, location, vi.fn())} />);
}

function renderInteractiveSidebar(
  location: Parameters<typeof LibrarySidebar>[0]["location"] = { type: "library" },
  onLocationChange = vi.fn(),
  overrides: Partial<Parameters<typeof LibrarySidebar>[0]> = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <TooltipProvider>
        <LibrarySidebar {...sidebarProps([], location, onLocationChange)} {...overrides} />
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
    const sidebarNavigationRef = useRef<HTMLElement>(null);

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
          sidebarNavigationRef={sidebarNavigationRef}
        />
        <LibrarySidebar
          {...sidebarProps(folders)}
          collapsed={collapsed}
          expandedContentRef={expandedContentRef}
          navigationRef={sidebarNavigationRef}
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

let activeRoot: Root | null = null;

describe("LibrarySidebar", () => {
  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture"])(
    "batches drag updates and flushes the final width on %s",
    (finishEvent) => {
      const frames = new Map<number, FrameRequestCallback>();
      let frameId = 0;
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.set(++frameId, callback);
        return frameId;
      });
      vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
      const onWidthChange = vi.fn();
      const onWidthCommit = vi.fn();
      const session = renderInteractiveSidebar(undefined, undefined, {
        resizable: true,
        width: 240,
        onWidthChange,
        onWidthCommit,
      });
      activeRoot = session.root;
      const handle = session.container.querySelector<HTMLElement>('[aria-label="Resize sidebar"]');
      if (!handle) throw new Error("Resize handle was not rendered.");
      handle.setPointerCapture = vi.fn();
      handle.hasPointerCapture = () => true;
      handle.releasePointerCapture = vi.fn();
      const dispatch = (type: string, clientX: number) =>
        act(() => {
          handle.dispatchEvent(
            new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX }),
          );
        });
      dispatch("pointerdown", 240);
      dispatch("pointermove", 248);
      dispatch("pointermove", 260);
      expect(onWidthChange).not.toHaveBeenCalled();
      expect(frames.size).toBe(1);
      act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(0));
      });
      expect(onWidthChange.mock.calls).toEqual([[260]]);
      dispatch("pointermove", 272);
      dispatch("pointermove", 280);
      dispatch(finishEvent, 280);
      expect(onWidthChange.mock.calls).toEqual([[260], [280]]);
      expect(onWidthCommit).toHaveBeenCalledExactlyOnceWith(280);
      expect(frames.size).toBe(0);
      dispatch("lostpointercapture", 280);
      expect(onWidthCommit).toHaveBeenCalledOnce();
    },
  );

  it("cancels a pending resize frame on unmount and preserves immediate keyboard resizing", () => {
    const schedule = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", schedule);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const onWidthChange = vi.fn();
    const onWidthCommit = vi.fn();
    const session = renderInteractiveSidebar(undefined, undefined, {
      resizable: true,
      width: 240,
      onWidthChange,
      onWidthCommit,
    });
    activeRoot = session.root;
    const handle = session.container.querySelector<HTMLElement>('[aria-label="Resize sidebar"]');
    if (!handle) throw new Error("Resize handle was not rendered.");
    handle.setPointerCapture = vi.fn();
    act(() =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(248);
    expect(onWidthCommit).toHaveBeenCalledExactlyOnceWith(248);
    expect(schedule).not.toHaveBeenCalled();
    act(() => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 240 }),
      );
      handle.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 260 }),
      );
    });
    expect(schedule).toHaveBeenCalledOnce();
    act(() => session.root.unmount());
    activeRoot = null;
    expect(cancel).toHaveBeenCalledWith(7);
    expect(onWidthChange).toHaveBeenCalledOnce();
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

  it("uses the shared sidebar Folder sort control", () => {
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
    const mostBooks = Array.from(container.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes("Most books"),
    );
    act(() => mostBooks && activateSelectOption(mostBooks));

    expect(onFolderSortChange).toHaveBeenCalledWith("most-books");
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
    const expandedContent = session.container.querySelector(".sidebar__expanded-content");
    expect(expandedContent?.hasAttribute("inert")).toBe(true);
    expect(expandedContent?.getAttribute("aria-hidden")).toBe("true");
    expect(expandedContent?.textContent).toContain("Black Saint");
    expect(session.container.querySelector(".sidebar__folder-scroll")).not.toBeNull();
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

  it("keeps the archive switcher focused on known archives and management", () => {
    const markup = renderSidebar();
    const archiveRows = markup.match(
      /<button class="menu-item menu-item--no-icon archive-switcher__archive"[\s\S]*?<\/button>/g,
    );

    expect(markup).toContain("Books");
    expect(markup).toContain("Comics");
    expect(markup).toContain("Manage archives");
    expect(markup).toContain("Reveal archive folder");
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
    expect(markup).not.toContain('role="menu"');
    expect(markup).not.toContain('role="menuitem"');
  });

  it.each(["Reveal archive folder", "Manage archives"])(
    "closes and restores switcher focus before %s runs",
    (label) => {
      const invoke = vi.fn(() => {
        expect(details.open).toBe(false);
        expect(document.activeElement).toBe(summary);
      });
      const session = renderInteractiveSidebar({ type: "library" }, vi.fn(), {
        onRevealArchive: invoke,
        onManageArchives: invoke,
      });
      activeRoot = session.root;
      const details = session.container.querySelector<HTMLDetailsElement>(".archive-switcher")!;
      const summary = details.querySelector("summary")!;
      const action = Array.from(details.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === label,
      )!;
      act(() => {
        details.open = true;
        action.focus();
        action.click();
      });
      expect(invoke).toHaveBeenCalledOnce();
    },
  );

  it("keeps unavailable archive reveal focusable, explained, and inert", () => {
    const onRevealArchive = vi.fn();
    const reason = "The active archive folder is unavailable.";
    const session = renderInteractiveSidebar({ type: "library" }, vi.fn(), {
      onRevealArchive,
      revealArchiveDisabledReason: reason,
    });
    activeRoot = session.root;
    const details = session.container.querySelector<HTMLDetailsElement>(".archive-switcher")!;
    const action = Array.from(details.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Reveal archive folder"),
    )!;
    expect(action.getAttribute("aria-disabled")).toBe("true");
    expect(action.disabled).toBe(false);
    expect(document.getElementById(action.getAttribute("aria-describedby")!)?.textContent).toBe(
      reason,
    );
    act(() => {
      details.open = true;
      action.focus();
      action.click();
    });
    expect(document.activeElement).toBe(action);
    expect(details.open).toBe(true);
    expect(onRevealArchive).not.toHaveBeenCalled();
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

  it("shows Series as a first-class navigation location", () => {
    const markup = renderSidebar([], { type: "series-detail", seriesKey: "star saga" });

    expect(markup).toContain("Series");
    expect(markup).toMatch(/aria-current="page"[\s\S]*?>Series</);
  });

  it.each([
    ["Library", "library"],
    ["Series", "series"],
    ["Favorites", "favorites"],
    ["Folders", "folders"],
  ] as const)("activates %s with keyboard-compatible focus", (label, type) => {
    const session = renderInteractiveSidebar({ type });
    activeRoot = session.root;
    const control = session.container.querySelector<HTMLButtonElement>(
      `.sidebar__nav [aria-label="${label}"]`,
    );
    if (!control) throw new Error(`Missing ${label} navigation control.`);
    expect(control.getAttribute("aria-current")).toBe("page");
    act(() => {
      control.focus();
      control.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(document.activeElement).toBe(control);
    expect(session.onLocationChange).toHaveBeenCalledExactlyOnceWith({ type });
  });

  it("switches to the selected saved archive and closes its menu", () => {
    const onSwitchArchive = vi.fn();
    const session = renderInteractiveSidebar(undefined, undefined, { onSwitchArchive });
    activeRoot = session.root;
    const details = session.container.querySelector<HTMLDetailsElement>(".archive-switcher");
    const saved = session.container.querySelector<HTMLButtonElement>(".archive-switcher__archive");
    if (!details || !saved) throw new Error("Saved archive control was not rendered.");
    act(() => {
      details.open = true;
      saved.click();
    });
    expect(onSwitchArchive).toHaveBeenCalledExactlyOnceWith(savedArchive);
    expect(details.open).toBe(false);
  });
});
