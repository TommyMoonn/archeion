// @vitest-environment happy-dom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WindowTitlebarAppActionsHost } from "../../components/WindowTitlebar";
import { TooltipProvider } from "../../components/Tooltip";
import { LibraryTitlebarActions } from "./LibraryTitlebarActions";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function renderActions({
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
        <LibraryTitlebarActions
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

describe("LibraryTitlebarActions", () => {
  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    document.body.innerHTML = "";
  });

  it("renders the three accepted actions in order outside the drag region", () => {
    const { container } = renderActions();
    const actionGroup = container.querySelector(".library-titlebar-actions");
    const labels = Array.from(actionGroup?.querySelectorAll("button") ?? []).map((button) =>
      button.getAttribute("aria-label"),
    );

    expect(labels).toEqual([
      "Collapse sidebar",
      "Open Quick Actions",
      "Reveal active archive folder",
    ]);
    expect(
      Array.from(actionGroup?.querySelectorAll("button") ?? []).every((button) =>
        button.classList.contains("icon-button--standard"),
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

  it("preserves sidebar focus before expanded navigation is removed", () => {
    const { container } = renderActions();
    const expandedAction = container.querySelector<HTMLButtonElement>(
      "button:not(.library-titlebar-actions__button)",
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
    const { container } = renderActions({ onOpenQuickActions });
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
    const { container } = renderActions({
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

  it("omits only the collapse action in the constrained top-navigation layout", () => {
    const { container } = renderActions({ collapseAvailable: false });
    const labels = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".library-titlebar-actions button"),
    ).map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual(["Open Quick Actions", "Reveal active archive folder"]);
  });
});
