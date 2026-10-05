// @vitest-environment happy-dom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

function renderComposition({ collapseAvailable = true } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  function Harness() {
    const [collapsed, setCollapsed] = useState(false);
    const [libraryMounted, setLibraryMounted] = useState(true);
    const expandedContentRef = useRef<HTMLDivElement>(null);
    const sidebarNavigationRef = useRef<HTMLElement>(null);

    return (
      <>
        <header className="window-titlebar">
          <WindowTitlebarAppActionsHost />
          <div className="window-titlebar__drag-region" data-tauri-drag-region />
        </header>
        <button type="button" onClick={() => setLibraryMounted(!libraryMounted)}>
          {libraryMounted ? "Enter Reader" : "Return to Library"}
        </button>
        {libraryMounted ? (
          <LibraryTitlebarComposition
            collapseAvailable={collapseAvailable}
            collapsed={collapsed}
            expandedSidebarContentRef={expandedContentRef}
            onCollapsedChange={setCollapsed}
            sidebarNavigationRef={sidebarNavigationRef}
            sidebarToggleAriaKeyShortcuts="Control+B"
          />
        ) : null}
        <nav ref={sidebarNavigationRef}>
          <button type="button" aria-current="page">
            Library navigation
          </button>
        </nav>
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
  return { container };
}

function renderResponsiveComposition() {
  media = installLibrarySidebarMedia(false);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  function Harness() {
    const sidebarState = useLibrarySidebarState();
    const expandedContentRef = useRef<HTMLDivElement>(null);
    const sidebarNavigationRef = useRef<HTMLElement>(null);

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
          sidebarNavigationRef={sidebarNavigationRef}
          sidebarToggleAriaKeyShortcuts="Control+B"
        />
        <nav ref={sidebarNavigationRef}>
          <button type="button" aria-current="page">
            Library navigation
          </button>
        </nav>
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
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    document.body.innerHTML = "";
    media?.restore();
    media = null;
  });

  it("renders the expanded wordmark and actions with draggable space outside the controls", () => {
    const { container } = renderComposition();
    const composition = container.querySelector(".library-titlebar-composition");
    const actionGroup = container.querySelector(".library-titlebar-composition__actions");

    expect(composition?.getAttribute("data-sidebar-collapsed")).toBe("false");
    expect(composition?.getAttribute("data-collapse-available")).toBe("true");
    expect(composition?.closest('[data-window-titlebar-presentation="split"]')).not.toBeNull();
    expect(
      composition
        ?.querySelector(".library-titlebar-composition__drag-region")
        ?.hasAttribute("data-tauri-drag-region"),
    ).toBe(true);
    expect(
      composition
        ?.querySelector(".library-titlebar-composition__wordmark")
        ?.hasAttribute("data-tauri-drag-region"),
    ).toBe(true);
    expect(container.querySelector(".library-titlebar-composition__wordmark")?.textContent).toBe(
      "Archeion",
    );
    expect(actionLabels(container)).toEqual(["Collapse sidebar"]);
    expect(
      container
        .querySelector('button[aria-label="Collapse sidebar"]')
        ?.getAttribute("aria-keyshortcuts"),
    ).toBe("Control+B");
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

  it("removes split presentation and portal content on Library unmount and restores it on return", () => {
    const { container } = renderComposition();
    const split = () => container.querySelector('[data-window-titlebar-presentation="split"]');
    expect(split()).not.toBeNull();

    act(() =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Enter Reader")
        ?.click(),
    );
    expect(split()).toBeNull();
    expect(container.querySelector(".library-titlebar-composition")).toBeNull();
    expect(container.querySelector(".window-titlebar__app-actions")?.childElementCount).toBe(0);
    expect(container.querySelector(".window-titlebar__drag-region")).not.toBeNull();

    act(() =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Return to Library")
        ?.click(),
    );
    expect(split()).not.toBeNull();
    expect(container.querySelectorAll(".library-titlebar-composition")).toHaveLength(1);
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
    expect(actionLabels(container)).toEqual(["Collapse sidebar"]);
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

  it("omits only the unavailable collapse control in the constrained top layout", () => {
    const { container } = renderComposition({ collapseAvailable: false });
    const composition = container.querySelector(".library-titlebar-composition");

    expect(composition?.getAttribute("data-collapse-available")).toBe("false");
    expect(container.querySelector('[data-window-titlebar-presentation="split"]')).toBeNull();
    expect(container.querySelector(".library-titlebar-composition__wordmark")?.textContent).toBe(
      "Archeion",
    );
    expect(actionLabels(container)).toEqual([]);
  });

  it("retains requested collapse across constrained navigation without moving navigation focus", () => {
    const { container, media } = renderResponsiveComposition();
    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')?.click(),
    );
    act(() => media.setMatches(true));
    const navigation = container.querySelector<HTMLButtonElement>("nav button")!;
    act(() => navigation.focus());
    act(() => media.setMatches(false));
    expect(actionLabels(container)).toEqual(["Expand sidebar"]);
    expect(document.activeElement).toBe(navigation);
  });

  it.each(["Expand sidebar", "Collapse sidebar"])(
    "moves focused %s to current navigation when constrained layout removes it",
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

      expect(actionLabels(container)).toEqual([]);
      expect(document.activeElement).toBe(
        container.querySelector('nav button[aria-current="page"]'),
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
