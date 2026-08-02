// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReaderChapter, ReaderNavigationState } from "../../types/reader";
import { ReaderSideSurfaceLayer } from "./ReaderSideSurfaceLayer";
import { ReaderTocPanel } from "./ReaderTocPanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

function chapter(id: string, label: string, depth = 0): ReaderChapter {
  return { id, label, href: `${id}.xhtml`, depth };
}

function navigation(
  chapters: readonly ReaderChapter[],
  currentChapterId?: string,
): ReaderNavigationState {
  return { chapters, currentChapterId, status: "ready" };
}

function renderPanel(
  state: ReaderNavigationState,
  options: {
    onClose?: () => void;
    onNavigate?: (chapterId: string) => Promise<boolean>;
  } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onClose = vi.fn(options.onClose);
  const onNavigate = vi.fn(options.onNavigate ?? (async () => true));

  act(() => {
    root?.render(
      <ReaderSideSurfaceLayer onDismiss={onClose}>
        <ReaderTocPanel navigation={state} onClose={onClose} onNavigate={onNavigate} />
      </ReaderSideSurfaceLayer>,
    );
  });

  return { container, onClose, onNavigate };
}

describe("ReaderTocPanel", () => {
  it("focuses and reveals the current chapter without scrolling outside the drawer", () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const broadScroll = vi.fn(() => {
      document.documentElement.scrollTop = 900;
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: broadScroll,
    });
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("reader-toc__body")) return new DOMRect(0, 100, 380, 200);
        if (this.getAttribute("aria-current") === "location") {
          return new DOMRect(0, 420, 360, 38);
        }
        return new DOMRect();
      });
    document.documentElement.scrollTop = 0;

    try {
      const chapters = Array.from({ length: 8 }, (_, index) =>
        chapter(`chapter-${index + 1}`, `Chapter ${index + 1}`),
      );
      const { container } = renderPanel(navigation(chapters, "chapter-8"));
      const body = container.querySelector<HTMLElement>(".reader-toc__body")!;
      const current = container.querySelector<HTMLButtonElement>('[aria-current="location"]')!;

      expect(document.activeElement).toBe(current);
      expect(body.scrollTop).toBe(158);
      expect(document.documentElement.scrollTop).toBe(0);
      expect(broadScroll).not.toHaveBeenCalled();
    } finally {
      bounds.mockRestore();
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  it("focuses search without scrolling the Reader and still reveals the current chapter locally", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("reader-toc__body")) return new DOMRect(0, 100, 380, 200);
        if (this.getAttribute("aria-current") === "location") {
          return new DOMRect(0, 420, 360, 38);
        }
        return new DOMRect();
      });
    const chapters = Array.from({ length: 13 }, (_, index) =>
      chapter(`chapter-${index + 1}`, `Chapter ${index + 1}`),
    );

    try {
      const { container } = renderPanel(navigation(chapters, "chapter-1"));
      const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      const body = container.querySelector<HTMLElement>(".reader-toc__body")!;

      expect(document.activeElement).toBe(search);
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(body.scrollTop).toBe(158);
    } finally {
      focus.mockRestore();
      bounds.mockRestore();
    }
  });

  it("focuses the drawer when no current chapter or search is available", () => {
    const { container } = renderPanel(navigation([chapter("chapter-1", "Chapter One")]));
    const panel = container.querySelector<HTMLElement>('[aria-label="Table of contents"]');

    expect(document.activeElement).toBe(panel);
  });

  it("renders nested chapters and marks the current location", () => {
    const { container } = renderPanel(
      navigation(
        [chapter("part", "Part One"), chapter("chapter-1", "Chapter One", 1)],
        "chapter-1",
      ),
    );
    const current = container.querySelector<HTMLButtonElement>('[aria-current="location"]');

    expect(container.querySelector(".reader-side-panel.reader-toc")).not.toBeNull();
    expect(container.querySelector(".reader-side-panel__header")?.textContent).toContain(
      "Contents",
    );
    expect(current?.textContent).toContain("Chapter One");
    expect(current?.style.getPropertyValue("--chapter-indent")).toBe("18px");
    expect(container.querySelector('nav[aria-label="Book chapters"]')).not.toBeNull();
  });

  it("closes the current chapter without moving", () => {
    const { container, onClose, onNavigate } = renderPanel(
      navigation([chapter("chapter-1", "Chapter One")], "chapter-1"),
    );
    const current = container.querySelector<HTMLButtonElement>('[aria-current="location"]');

    act(() => current?.click());

    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves once and closes after another chapter opens", async () => {
    const { container, onClose, onNavigate } = renderPanel(
      navigation(
        [chapter("chapter-1", "Chapter One"), chapter("chapter-2", "Chapter Two")],
        "chapter-1",
      ),
    );
    const nextChapter = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Chapter Two"),
    );

    await act(async () => {
      nextChapter?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("chapter-2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed destination open and reports the error", async () => {
    const { container, onClose } = renderPanel(navigation([chapter("chapter-1", "Chapter One")]), {
      onNavigate: async () => false,
    });
    const destination = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Chapter One"),
    );

    await act(async () => {
      destination?.click();
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be opened");
  });

  it("shows search only for large contents and filters chapter labels", () => {
    const chapters = Array.from({ length: 13 }, (_, index) =>
      chapter(`chapter-${index + 1}`, index === 12 ? "The Last Chapter" : `Chapter ${index + 1}`),
    );
    const { container } = renderPanel(navigation(chapters));
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');

    expect(search).not.toBeNull();
    act(() => {
      if (!search) return;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(search, "last");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const chapterButtons = container.querySelectorAll(".reader-toc__chapter");
    expect(chapterButtons).toHaveLength(1);
    expect(chapterButtons[0]?.textContent).toContain("The Last Chapter");
  });

  it("shows loading and empty states without exposing a false empty state", () => {
    const loading = renderPanel({ chapters: [], status: "loading" });
    expect(loading.container.querySelector('[role="status"]')).not.toBeNull();
    expect(loading.container.textContent).not.toContain("No table of contents");

    act(() => {
      root?.render(
        <ReaderTocPanel
          navigation={{ chapters: [], status: "ready" }}
          onClose={loading.onClose}
          onNavigate={loading.onNavigate}
        />,
      );
    });

    expect(loading.container.textContent).toContain("No table of contents");
  });

  it("closes on Escape before the reader can handle it", () => {
    const { container, onClose } = renderPanel(navigation([chapter("chapter-1", "Chapter One")]));
    const panel = container.querySelector<HTMLElement>('[aria-label="Table of contents"]');
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });

    act(() => panel?.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
