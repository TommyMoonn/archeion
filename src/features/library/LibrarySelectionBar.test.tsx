// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/Tooltip";
import { LibrarySelectionBar } from "./LibrarySelectionBar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderSelectionBar({
  onAction = vi.fn(),
  selectedCount = 2,
  visibleCount = 4,
  visibleSelectedCount = 2,
  busy = false,
}: {
  onAction?: Parameters<typeof LibrarySelectionBar>[0]["onAction"];
  selectedCount?: number;
  visibleCount?: number;
  visibleSelectedCount?: number;
  busy?: boolean;
} = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <TooltipProvider>
        <LibrarySelectionBar
          busy={busy}
          onAction={onAction}
          onClear={vi.fn()}
          onDeselectVisible={vi.fn()}
          onExit={vi.fn()}
          onSelectVisible={vi.fn()}
          selectedCount={selectedCount}
          visibleCount={visibleCount}
          visibleSelectedCount={visibleSelectedCount}
        />
      </TooltipProvider>,
    );
  });

  return { container, root };
}

let activeRoot: Root | null = null;

describe("LibrarySelectionBar", () => {
  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
    document.body.innerHTML = "";
  });

  it("groups ghost bulk actions beside the status and moves Select all beside Clear", () => {
    const session = renderSelectionBar();
    activeRoot = session.root;

    const primary = session.container.querySelector(".library-selection-bar__primary");
    const trailingActions = session.container.querySelector(".library-selection-bar__actions");
    const trailingLabels = Array.from(
      trailingActions?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      (button) => button.textContent,
    );

    expect(primary?.textContent).not.toContain("Select all");
    expect(trailingLabels).toEqual(["Select all", "Clear", "Done"]);
    expect(
      primary
        ?.querySelector<HTMLButtonElement>('button[aria-label="Add selected books to favorites"]')
        ?.classList.contains("library-selection-bar__icon-action"),
    ).toBe(true);
    expect(
      primary
        ?.querySelector<HTMLButtonElement>('button[aria-label="Move selected books"]')
        ?.classList.contains("library-selection-bar__icon-action"),
    ).toBe(true);
    expect(
      primary
        ?.querySelector('button[aria-label="More bulk actions"]')
        ?.classList.contains("library-selection-bar__icon-action"),
    ).toBe(true);
  });

  it("exposes a labeled action group with independently focusable controls", () => {
    const session = renderSelectionBar();
    activeRoot = session.root;
    const group = session.container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Book selection actions"]',
    );

    expect(group).not.toBeNull();
    expect(session.container.querySelector('[role="toolbar"]')).toBeNull();

    const controls = Array.from(group!.querySelectorAll<HTMLElement>("button"));
    expect(controls.length).toBeGreaterThan(1);
    for (const control of controls) {
      act(() => control.focus());
      expect(document.activeElement).toBe(control);
    }
  });

  it("exposes a decorative selection icon and tooltips for icon actions", () => {
    const session = renderSelectionBar();
    activeRoot = session.root;

    const statusIcon = session.container.querySelector<SVGElement>(
      ".library-selection-bar__status-icon",
    );
    const favorite = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add selected books to favorites"]',
    );
    const move = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Move selected books"]',
    );
    const more = session.container.querySelector<HTMLElement>(
      'button[aria-label="More bulk actions"]',
    );

    expect(statusIcon?.getAttribute("aria-hidden")).toBe("true");
    for (const [control, label] of [
      [favorite, "Add selected books to favorites"],
      [move, "Move selected books"],
      [more, "More bulk actions"],
    ] as const) {
      expect(control?.getAttribute("title")).toBeNull();
      expect(
        document.getElementById(control?.getAttribute("aria-describedby") ?? "")?.textContent,
      ).toBe(label);
    }
  });

  it("uses concise visible annotation export labels without redundant tooltips", () => {
    const onAction = vi.fn();
    const session = renderSelectionBar({ onAction });
    activeRoot = session.root;

    const trigger = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="More bulk actions"]',
    )!;
    act(() => trigger.click());
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const markdown = items.find((button) => button.textContent === "Annotations (Markdown)");
    const json = items.find((button) => button.textContent === "Annotations (JSON)");
    expect(markdown).toBeDefined();
    expect(json).toBeDefined();

    expect(markdown?.title).toBe("");
    expect(json?.title).toBe("");
    expect(markdown?.getAttribute("aria-describedby")).toBeNull();
    expect(json?.getAttribute("aria-describedby")).toBeNull();

    act(() => json?.click());
    expect(onAction).toHaveBeenCalledWith("annotations-json");
  });

  it("opens an accessible action menu and restores focus on Escape", () => {
    const session = renderSelectionBar();
    activeRoot = session.root;
    const trigger = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="More bulk actions"]',
    )!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(
      Array.from(menu!.querySelectorAll('[role="menuitem"]'), (item) => item.textContent),
    ).toContain("Edit metadata");
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([{ selectedCount: 0, visibleSelectedCount: 0 }, { busy: true }])(
    "does not dispatch unavailable bulk actions (%j)",
    (options) => {
      const onAction = vi.fn();
      const session = renderSelectionBar({ onAction, ...options });
      activeRoot = session.root;
      const trigger = session.container.querySelector<HTMLButtonElement>(
        'button[aria-label="More bulk actions"]',
      )!;
      act(() => trigger.click());
      const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      expect(items).toHaveLength(8);
      expect(items.every((item) => item.disabled)).toBe(true);
      act(() => items.forEach((item) => item.click()));
      expect(onAction).not.toHaveBeenCalled();
    },
  );
});
