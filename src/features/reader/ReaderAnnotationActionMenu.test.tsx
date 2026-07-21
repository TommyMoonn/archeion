// @vitest-environment happy-dom

import { act, useRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activeTransientSurfaceKind,
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import { ReaderAnnotationActionMenu } from "./ReaderAnnotationActionMenu";
import { useReaderAnnotationActionMenu } from "./useReaderAnnotationActionMenu";

const timestamp = "2026-07-12T00:00:00.000Z";
const bookmark: BookmarkAnnotation = {
  cfiRange: "epubcfi(/6/2)",
  createdAt: timestamp,
  id: "bookmark-1",
  label: "Opening",
  type: "bookmark",
  updatedAt: timestamp,
};
const highlight: HighlightAnnotation = {
  cfiRange: "epubcfi(/6/4,/1:0,/1:12)",
  color: "blue",
  createdAt: timestamp,
  id: "highlight-1",
  note: "Remember",
  selectedText: "Quoted passage",
  type: "highlight",
  updatedAt: timestamp,
};

function rect({
  bottom,
  left,
  right,
  top,
}: {
  bottom: number;
  left: number;
  right: number;
  top: number;
}) {
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    toJSON: () => ({}),
    top,
    width: right - left,
    x: left,
    y: top,
  } as DOMRect;
}

type MenuProps = Omit<
  ComponentProps<typeof ReaderAnnotationActionMenu>,
  "menu" | "menuRef" | "onClose" | "onEscape" | "onOpenColors"
>;

function Harness({
  annotation,
  blocked = false,
  menuProps,
}: {
  annotation: Annotation;
  blocked?: boolean;
  menuProps: MenuProps;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const controller = useReaderAnnotationActionMenu({ blocked, panelRef });
  return (
    <aside ref={panelRef}>
      <button
        aria-label="Open actions"
        data-annotation-menu-trigger
        onClick={(event) => controller.open(event, annotation)}
        type="button"
      >
        Actions
      </button>
      <ReaderAnnotationActionMenu
        menu={controller.menu}
        menuRef={controller.menuRef}
        onClose={controller.close}
        onEscape={controller.handleEscape}
        onOpenColors={controller.openColors}
        {...menuProps}
      />
    </aside>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function defaultMenuProps(overrides: Partial<MenuProps> = {}): MenuProps {
  return {
    busyAnnotationId: undefined,
    onBeginBookmarkRename: vi.fn(),
    onBeginRemoval: vi.fn(),
    onCopyDetached: vi.fn(),
    onEditNote: vi.fn(),
    onNavigate: vi.fn(),
    onRecolor: vi.fn(async () => true),
    onRecover: vi.fn(),
    ...overrides,
  };
}

function mount(node: ReactNode) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  act(() => root?.render(node));
  return container;
}

function textButton(target: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Button ${label} was not rendered.`);
  return match;
}

function openMenu(target: HTMLElement, panelRect: DOMRect, triggerRect: DOMRect) {
  const panel = target.querySelector("aside")!;
  const trigger = target.querySelector<HTMLButtonElement>('[aria-label="Open actions"]')!;
  panel.getBoundingClientRect = () => panelRect;
  trigger.getBoundingClientRect = () => triggerRect;
  act(() => trigger.click());
  return trigger;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetTransientSurfaceOwnershipForTests();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ReaderAnnotationActionMenu", () => {
  it("owns anchored placement and wrapped keyboard movement", () => {
    const target = mount(<Harness annotation={highlight} menuProps={defaultMenuProps()} />);
    openMenu(
      target,
      rect({ bottom: 400, left: 0, right: 320, top: 0 }),
      rect({ bottom: 360, left: 270, right: 310, top: 330 }),
    );

    const menu = target.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.dataset.placement).toBe("above");
    expect(menu.style.getPropertyValue("--annotation-menu-right")).toBe("10px");
    const first = textButton(target, "Go to location");
    const last = textButton(target, "Remove highlight");
    expect(document.activeElement).toBe(first);

    act(() => {
      first.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowUp" }),
      );
    });
    expect(document.activeElement).toBe(last);
  });

  it("dismisses outside pointers and Escape while restoring the exact trigger", () => {
    const target = mount(<Harness annotation={bookmark} menuProps={defaultMenuProps()} />);
    const addListener = vi.spyOn(document, "addEventListener");
    const trigger = openMenu(
      target,
      rect({ bottom: 500, left: 0, right: 320, top: 0 }),
      rect({ bottom: 120, left: 260, right: 300, top: 90 }),
    );
    expect(
      addListener.mock.calls.filter(
        ([type, , options]) => type === "pointerdown" && options === true,
      ),
    ).toHaveLength(0);
    const outside = document.body.appendChild(document.createElement("button"));

    act(() => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    act(() => trigger.click());
    act(() => {
      target
        .querySelector('[role="menu"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
        );
    });
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    outside.remove();
  });

  it("closes the complete action menu when a modal opens without restoring focus behind it", () => {
    const target = mount(<Harness annotation={bookmark} menuProps={defaultMenuProps()} />);
    const trigger = openMenu(
      target,
      rect({ bottom: 500, left: 0, right: 320, top: 0 }),
      rect({ bottom: 120, left: 260, right: 300, top: 90 }),
    );
    const modal = document.body.appendChild(document.createElement("div"));
    modal.tabIndex = -1;
    modal.focus();
    let unregister: () => void = () => undefined;

    act(() => {
      unregister = registerTransientSurface({
        element: modal,
        kind: "app-dialog",
        modal: true,
        onDismiss: vi.fn(),
      });
    });

    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(modal);
    expect(document.activeElement).not.toBe(trigger);
    unregister();
    modal.remove();
  });

  it("closes the complete color submenu when a modal opens", () => {
    const target = mount(<Harness annotation={highlight} menuProps={defaultMenuProps()} />);
    openMenu(
      target,
      rect({ bottom: 500, left: 0, right: 320, top: 0 }),
      rect({ bottom: 120, left: 260, right: 300, top: 90 }),
    );
    act(() => textButton(target, "Recolor highlight").click());
    expect(target.querySelector('[aria-label="Highlight color"]')).toBeInstanceOf(HTMLElement);
    const modal = document.body.appendChild(document.createElement("div"));
    let unregister: () => void = () => undefined;

    act(() => {
      unregister = registerTransientSurface({
        element: modal,
        kind: "app-dialog",
        modal: true,
        onDismiss: vi.fn(),
      });
    });

    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(target.textContent).not.toContain("Go to location");
    unregister();
    modal.remove();
  });

  it("keeps Escape's color-submenu step-back behavior", () => {
    const target = mount(<Harness annotation={highlight} menuProps={defaultMenuProps()} />);
    const trigger = openMenu(
      target,
      rect({ bottom: 500, left: 0, right: 320, top: 0 }),
      rect({ bottom: 120, left: 260, right: 300, top: 90 }),
    );
    act(() => textButton(target, "Recolor highlight").click());

    act(() =>
      target
        .querySelector('[role="menu"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
        ),
    );

    expect(target.querySelector('[role="menu"]')).toBeInstanceOf(HTMLElement);
    expect(textButton(target, "Recolor highlight")).toBe(document.activeElement);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("window blur closes the complete menu without leaving a registered surface", () => {
    const target = mount(<Harness annotation={bookmark} menuProps={defaultMenuProps()} />);
    openMenu(
      target,
      rect({ bottom: 500, left: 0, right: 320, top: 0 }),
      rect({ bottom: 120, left: 260, right: 300, top: 90 }),
    );

    act(() => window.dispatchEvent(new Event("blur")));

    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(activeTransientSurfaceKind()).toBeNull();
  });

  it("keeps bookmark and highlight actions type-specific", () => {
    const bookmarkProps = defaultMenuProps();
    let target = mount(<Harness annotation={bookmark} menuProps={bookmarkProps} />);
    openMenu(
      target,
      rect({ bottom: 500, left: 0, right: 320, top: 0 }),
      rect({ bottom: 120, left: 260, right: 300, top: 90 }),
    );
    expect(target.textContent).toContain("Rename bookmark");
    expect(target.textContent).not.toContain("Recolor highlight");
    expect(target.textContent).not.toContain("Add note");

    act(() => root?.render(<Harness annotation={highlight} menuProps={defaultMenuProps()} />));
    target = container!;
    openMenu(
      target,
      rect({ bottom: 500, left: 0, right: 320, top: 0 }),
      rect({ bottom: 120, left: 260, right: 300, top: 90 }),
    );
    expect(target.textContent).toContain("Recolor highlight");
    expect(target.textContent).toContain("Edit note");
    expect(target.textContent).not.toContain("Rename bookmark");
  });

  it("keeps a failed recolor menu open and closes it only after successful persistence", async () => {
    const onRecolor = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const target = mount(
      <Harness annotation={highlight} menuProps={defaultMenuProps({ onRecolor })} />,
    );
    const trigger = openMenu(
      target,
      rect({ bottom: 500, left: 0, right: 320, top: 0 }),
      rect({ bottom: 120, left: 260, right: 300, top: 90 }),
    );
    act(() => textButton(target, "Recolor highlight").click());
    const green = target.querySelector<HTMLButtonElement>('[data-color="green"]')!;

    await act(async () => green.click());
    expect(target.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => green.click());
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onRecolor).toHaveBeenCalledTimes(2);
  });
});
