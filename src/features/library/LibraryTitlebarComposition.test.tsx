// @vitest-environment happy-dom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WindowTitlebarAppActionsHost } from "../../components/WindowTitlebar";
import { TooltipProvider } from "../../components/Tooltip";
import { installLibrarySidebarMedia } from "./librarySidebarMedia.testUtils";
import { LibraryTitlebarComposition } from "./LibraryTitlebarComposition";
import { useLibrarySidebarState } from "./useLibrarySidebarState";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let media: ReturnType<typeof installLibrarySidebarMedia> | null = null;

function renderComposition({
  collapseAvailable = true,
  onOpenQuickActions = vi.fn(),
  onRevealArchive = vi.fn(),
  revealArchiveDisabledReason,
}: {
  collapseAvailable?: boolean;
  onOpenQuickActions?: () => void;
  onRevealArchive?: () => void;
  revealArchiveDisabledReason?: string;
} = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  function Harness() {
    const [collapsed, setCollapsed] = useState(false);
    const expandedContentRef = useRef<HTMLDivElement>(null);

    return (
      <>
        <header className="window-titlebar">
          <WindowTitlebarAppActionsHost />
          <div className="window-titlebar__drag-region" data-tauri-drag-region />
        </header>
        <LibraryTitlebarComposition
          collapseAvailable={collapseAvailable}
          collapsed={collapsed}
          expandedSidebarContentRef={expandedContentRef}
          onCollapsedChange={setCollapsed}
          onOpenQuickActions={onOpenQuickActions}
          onRevealArchive={onRevealArchive}
          quickActionsAriaKeyShortcuts="Control+Shift+P"
          revealArchiveDisabledReason={revealArchiveDisabledReason}
        />
        {!collapsed ? (
          <div ref={expandedContentRef}>
            <button type="button">Expanded navigation action</button>
          </div>
        ) : null}
      </>
    );
  }

  act(() =>
    root?.render(
      <TooltipProvider>
        <Harness />
      </TooltipProvider>,
    ),
  );
  return { container, onOpenQuickActions, onRevealArchive };
}

function renderResponsiveComposition() {
  media = installLibrarySidebarMedia(false);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  function Harness() {
    const sidebarState = useLibrarySidebarState();
    const expandedContentRef = useRef<HTMLDivElement>(null);

    return (
      <TooltipProvider>
        <header className="window-titlebar">
          <WindowTitlebarAppActionsHost />
          <div className="window-titlebar__drag-region" data-tauri-drag-region />
        </header>
        <LibraryTitlebarComposition
          collapseAvailable={sidebarState.collapseAvailable}
          collapsed={sidebarState.collapsed}
          expandedSidebarContentRef={expandedContentRef}
          onCollapsedChange={sidebarState.setCollapsed}
          onOpenQuickActions={vi.fn()}
          onRevealArchive={vi.fn()}
          quickActionsAriaKeyShortcuts="Control+Shift+P"
        />
        <button type="button">Outside titlebar</button>
        {!sidebarState.collapsed ? (
          <div ref={expandedContentRef}>
            <button type="button">Expanded navigation action</button>
          </div>
        ) : null}
      </TooltipProvider>
    );
  }

  act(() => root?.render(<Harness />));
  return { container, media };
}

function actionLabels(container: HTMLElement): Array<string | null> {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(".library-titlebar-composition__actions button"),
  ).map((button) => button.getAttribute("aria-label"));
}

describe("LibraryTitlebarComposition", () => {
  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    document.body.innerHTML = "";
    media?.restore();
    media = null;
  });

  it("renders the expanded wordmark and actions in sidebar-aligned order outside the drag region", () => {
    const { container } = renderComposition();
    const composition = container.querySelector(".library-titlebar-composition");
    const actionGroup = container.querySelector(".library-titlebar-composition__actions");

    expect(composition?.getAttribute("data-sidebar-collapsed")).toBe("false");
    expect(composition?.getAttribute("data-collapse-available")).toBe("true");
    expect(container.querySelector(".library-titlebar-composition__wordmark")?.textContent).toBe(
      "Archeion",
    );
    expect(actionLabels(container)).toEqual([
      "Reveal active archive folder",
      "Open Quick Actions",
      "Collapse sidebar",
    ]);
    expect(
      Array.from(actionGroup?.querySelectorAll("button") ?? []).every((button) =>
        button.classList.contains("icon-button--compact"),
      ),
    ).toBe(true);
    expect(actionGroup?.closest(".window-titlebar__app-actions")).not.toBeNull();
    expect(actionGroup?.closest("[data-tauri-drag-region]")).toBeNull();
    for (const action of actionGroup?.querySelectorAll("button") ?? []) {
      expect(action.closest("[data-tauri-drag-region]")).toBeNull();
      expect(action.title).toBe("");
      const descriptionId = action.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId!)?.textContent).toBe(
        action.getAttribute("aria-label"),
      );
    }
  });

  it("collapses to only the Expand action without hidden accessible content or tab stops", () => {
    const { container } = renderComposition();

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')?.click();
    });

    const composition = container.querySelector(".library-titlebar-composition");
    expect(composition?.getAttribute("data-sidebar-collapsed")).toBe("true");
    expect(container.querySelector(".library-titlebar-composition__wordmark")).toBeNull();
    expect(actionLabels(container)).toEqual(["Expand sidebar"]);
    expect(container.querySelector('[aria-label="Open Quick Actions"]')).toBeNull();
    expect(container.querySelector('[aria-label="Reveal active archive folder"]')).toBeNull();
    expect(
      container.querySelectorAll(".library-titlebar-composition button[tabindex]"),
    ).toHaveLength(0);
    expect(
      Array.from(document.querySelectorAll('[role="tooltip"]')).map(
        (tooltip) => tooltip.textContent,
      ),
    ).toEqual(["Expand sidebar"]);

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]')?.click();
    });

    expect(container.querySelector(".library-titlebar-composition__wordmark")?.textContent).toBe(
      "Archeion",
    );
    expect(actionLabels(container)).toEqual([
      "Reveal active archive folder",
      "Open Quick Actions",
      "Collapse sidebar",
    ]);
  });

  it("preserves sidebar focus before expanded navigation is removed", () => {
    const { container } = renderComposition();
    const expandedAction = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Expanded navigation action",
    )!;
    const collapse = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse sidebar"]',
    )!;

    act(() => expandedAction.focus());
    expect(document.activeElement).toBe(expandedAction);

    act(() => collapse.click());
    const expand = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand sidebar"]',
    );
    expect(document.activeElement).toBe(expand);

    act(() => expand?.click());
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Collapse sidebar"]'),
    );
  });

  it("opens Quick Actions exactly once and exposes its shortcut and owned tooltip", () => {
    const onOpenQuickActions = vi.fn();
    const { container } = renderComposition({ onOpenQuickActions });
    const action = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Quick Actions"]',
    )!;

    expect(action.title).toBe("");
    const descriptionId = action.getAttribute("aria-describedby");
    expect(document.getElementById(descriptionId!)?.textContent).toBe("Open Quick Actions");
    expect(action.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+P");
    act(() => action.focus());
    expect(document.activeElement).toBe(action);
    act(() => action.click());
    expect(onOpenQuickActions).toHaveBeenCalledTimes(1);
  });

  it("keeps an unavailable reveal action focusable, explained, and inert", () => {
    const onRevealArchive = vi.fn();
    const reason = "The active archive folder is unavailable.";
    const { container } = renderComposition({
      onRevealArchive,
      revealArchiveDisabledReason: reason,
    });
    const action = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reveal active archive folder"]',
    )!;
    const descriptionId = action.getAttribute("aria-describedby");

    expect(action.getAttribute("aria-disabled")).toBe("true");
    expect(action.disabled).toBe(false);
    expect(descriptionId).toBeTruthy();
    expect(action.title).toBe("");
    expect(document.getElementById(descriptionId!)?.textContent).toBe(reason);
    act(() => action.focus());
    expect(document.activeElement).toBe(action);
    act(() => action.click());
    expect(onRevealArchive).not.toHaveBeenCalled();
  });

  it("omits only the unavailable collapse control in the constrained top layout", () => {
    const { container } = renderComposition({ collapseAvailable: false });
    const composition = container.querySelector(".library-titlebar-composition");

    expect(composition?.getAttribute("data-collapse-available")).toBe("false");
    expect(container.querySelector(".library-titlebar-composition__wordmark")?.textContent).toBe(
      "Archeion",
    );
    expect(actionLabels(container)).toEqual(["Reveal active archive folder", "Open Quick Actions"]);
  });

  it("retains a requested collapsed state and moves focused Reveal to Expand on desktop return", () => {
    const { container, media } = renderResponsiveComposition();

    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')?.click(),
    );
    expect(actionLabels(container)).toEqual(["Expand sidebar"]);

    act(() => media.setMatches(true));
    expect(actionLabels(container)).toEqual(["Reveal active archive folder", "Open Quick Actions"]);

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Reveal active archive folder"]')
        ?.focus(),
    );
    act(() => media.setMatches(false));

    expect(actionLabels(container)).toEqual(["Expand sidebar"]);
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Expand sidebar"]'),
    );
  });

  it("moves focused Quick Actions to Expand when the retained collapsed state returns", () => {
    const { container, media } = renderResponsiveComposition();

    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')?.click(),
    );
    act(() => media.setMatches(true));
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Open Quick Actions"]')
        ?.focus(),
    );
    act(() => media.setMatches(false));

    expect(actionLabels(container)).toEqual(["Expand sidebar"]);
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Expand sidebar"]'),
    );
  });

  it.each(["Expand sidebar", "Collapse sidebar"])(
    "moves focused %s to adjacent Quick Actions when constrained layout removes it",
    (focusedAction) => {
      const { container, media } = renderResponsiveComposition();

      if (focusedAction === "Expand sidebar") {
        act(() =>
          container
            .querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')
            ?.click(),
        );
      }
      act(() =>
        container
          .querySelector<HTMLButtonElement>(`button[aria-label="${focusedAction}"]`)
          ?.focus(),
      );
      act(() => media.setMatches(true));

      expect(actionLabels(container)).toEqual([
        "Reveal active archive folder",
        "Open Quick Actions",
      ]);
      expect(document.activeElement).toBe(
        container.querySelector('button[aria-label="Open Quick Actions"]'),
      );
    },
  );

  it("does not move focus when responsive transitions remove no focused titlebar content", () => {
    const { container, media } = renderResponsiveComposition();
    const outside = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Outside titlebar",
    )!;

    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')?.click(),
    );
    act(() => outside.focus());
    act(() => media.setMatches(true));
    expect(document.activeElement).toBe(outside);

    act(() => media.setMatches(false));
    expect(document.activeElement).toBe(outside);
  });
});
