// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Annotation } from "../../types/annotation";
import { ReaderBookmarksPanel } from "./ReaderBookmarksPanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const bookmark: Annotation = {
  id: "bookmark-1",
  type: "bookmark",
  cfiRange: "epubcfi(/6/2!/4/2:10)",
  chapterHref: "Text/chapter-1.xhtml",
  label: "Chapter start",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function renderPanel(overrides: Partial<React.ComponentProps<typeof ReaderBookmarksPanel>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    bookmarks: [bookmark],
    busy: false,
    currentCfi: bookmark.cfiRange ?? "",
    onClose: vi.fn(),
    onNavigate: vi.fn(async () => true),
    onRemove: vi.fn(async () => true),
    onUpdateLabel: vi.fn(async () => true),
    ...overrides,
  };
  act(() => root?.render(<ReaderBookmarksPanel {...props} />));
  return { container, props };
}

describe("ReaderBookmarksPanel", () => {
  it("shows the current bookmark and navigates to it", async () => {
    const { container, props } = renderPanel();
    const target = container.querySelector<HTMLButtonElement>(".reader-bookmarks__target");
    expect(target?.getAttribute("aria-current")).toBe("location");
    expect(target?.textContent).toContain("Chapter start");

    await act(async () => target?.click());
    expect(props.onNavigate).toHaveBeenCalledWith(bookmark);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("supports editing labels and removing bookmarks without confirmation", async () => {
    const { container, props } = renderPanel();
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Edit Chapter start"]')
        ?.click(),
    );
    const input = container.querySelector<HTMLInputElement>("#bookmark-label-bookmark-1");
    expect(input?.value).toBe("Chapter start");

    act(() => {
      if (input) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(input, "Important scene");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>(".reader-bookmarks__edit")?.requestSubmit();
    });
    expect(props.onUpdateLabel).toHaveBeenCalledWith(bookmark, "Important scene");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Remove Chapter start"]')
        ?.click(),
    );
    expect(props.onRemove).toHaveBeenCalledWith(bookmark);
  });

  it("closes on Escape while preserving the current-location marker", () => {
    const { container, props } = renderPanel();
    const panel = container.querySelector<HTMLElement>("#reader-bookmarks");
    const target = container.querySelector<HTMLButtonElement>(".reader-bookmarks__target");

    expect(target?.getAttribute("aria-current")).toBe("location");
    act(() => {
      panel?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
