// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ReaderChapter,
  ReaderLandmark,
  ReaderNavigationState,
  ReaderPageReference,
} from "../../types/reader";
import { ReaderNavigationPanel } from "./ReaderNavigationPanel";
import { READER_PAGE_LIST_SEARCH_THRESHOLD } from "./readerNavigation";
import { ReaderSideSurfaceLayer } from "./ReaderSideSurfaceLayer";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function chapter(id: string, label: string, depth = 0): ReaderChapter {
  const href = `${id}.xhtml`;
  return { id, label, href, target: href, position: {}, depth };
}

function landmark(id: string, label: string, semanticType?: string): ReaderLandmark {
  const href = `${id}.xhtml`;
  return { id, label, href, target: href, position: {}, semanticType };
}

function pageReference(id: string, label: string): ReaderPageReference {
  const href = `chapter.xhtml#${id}`;
  return { id, label, href, target: href, position: {} };
}

function navigation(overrides: Partial<ReaderNavigationState> = {}): ReaderNavigationState {
  return {
    chapters: [],
    landmarks: [],
    pageReferences: [],
    status: "ready",
    ...overrides,
  };
}

function renderPanel(
  state: ReaderNavigationState,
  options: {
    onClose?: () => void;
    onNavigate?: (itemId: string) => Promise<boolean>;
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
        <ReaderNavigationPanel navigation={state} onClose={onClose} onNavigate={onNavigate} />
      </ReaderSideSurfaceLayer>,
    );
  });

  return { container, onClose, onNavigate };
}

function clickButtonByText(view: HTMLElement, label: string): HTMLButtonElement {
  const button = [...view.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  act(() => button.click());
  return button;
}

function setSearchValue(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ReaderNavigationPanel", () => {
  it("keeps the existing hierarchical Contents interaction for Contents-only publications", () => {
    const { container } = renderPanel(
      navigation({
        chapters: [chapter("part", "Part One"), chapter("chapter-1", "Chapter One", 1)],
        currentChapterId: "chapter-1",
      }),
    );
    const current = container.querySelector<HTMLButtonElement>('[aria-current="location"]');

    expect(container.querySelectorAll(".reader-navigation__collection")).toHaveLength(0);
    expect(container.querySelector(".reader-side-panel__header")?.textContent).toContain(
      "Contents",
    );
    expect(container.querySelector('nav[aria-label="Book chapters"]')).not.toBeNull();
    expect(current?.textContent).toContain("Chapter One");
    expect(current?.style.getPropertyValue("--chapter-indent")).toBe("18px");
  });

  it("preserves Contents search for large chapter collections", () => {
    const chapters = Array.from({ length: 13 }, (_, index) =>
      chapter(`chapter-${index + 1}`, index === 12 ? "The Last Chapter" : `Chapter ${index + 1}`),
    );
    const { container } = renderPanel(navigation({ chapters }));
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');

    expect(search).not.toBeNull();
    setSearchValue(search!, "last");

    const chapterButtons = container.querySelectorAll(".reader-navigation__chapter");
    expect(chapterButtons).toHaveLength(1);
    expect(chapterButtons[0]?.textContent).toContain("The Last Chapter");
  });

  it("exposes only usable publication navigation collections", () => {
    const { container } = renderPanel(
      navigation({
        chapters: [chapter("chapter-1", "Chapter One")],
        pageReferences: [pageReference("page-i", "i")],
      }),
    );
    const tabs = [
      ...container.querySelectorAll<HTMLButtonElement>(".reader-navigation__collection"),
    ].map((tab) => tab.textContent);

    expect(tabs).toEqual(["Contents", "Pages"]);
    expect(tabs).not.toContain("Landmarks");
  });

  it("shows semantic landmark information and navigates the selected landmark", async () => {
    const { container, onClose, onNavigate } = renderPanel(
      navigation({
        chapters: [chapter("chapter-1", "Chapter One")],
        landmarks: [landmark("landmark-cover", "Cover", "cover")],
      }),
    );
    clickButtonByText(container, "Landmarks");
    const cover = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Cover"),
    );

    expect(container.querySelector('nav[aria-label="Book landmarks"]')?.textContent).toContain(
      "cover",
    );
    await act(async () => {
      cover?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("landmark-cover");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves publisher page labels and navigates the selected page reference", async () => {
    const { container, onClose, onNavigate } = renderPanel(
      navigation({
        chapters: [chapter("chapter-1", "Chapter One")],
        pageReferences: [pageReference("page-xiv", "xiv"), pageReference("page-a12", "A-12")],
      }),
    );
    clickButtonByText(container, "Pages");

    expect(container.querySelector('nav[aria-label="Book pages"]')?.textContent).toContain("xiv");
    expect(container.querySelector('nav[aria-label="Book pages"]')?.textContent).toContain("A-12");
    const page = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "A-12",
    );

    await act(async () => {
      page?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("page-a12");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps short Page Lists directly browsable without Find page", () => {
    const pageReferences = Array.from({ length: READER_PAGE_LIST_SEARCH_THRESHOLD }, (_, index) =>
      pageReference(`page-${index + 1}`, String(index + 1)),
    );
    const { container } = renderPanel(navigation({ pageReferences }));

    expect(container.querySelector<HTMLInputElement>('input[type="search"]')).toBeNull();
    expect(container.querySelectorAll('nav[aria-label="Book pages"] button')).toHaveLength(
      READER_PAGE_LIST_SEARCH_THRESHOLD,
    );
  });

  it("filters a long Page List by publisher label case-insensitively while preserving labels and order", () => {
    const labels = [
      "i",
      "IV",
      "xii",
      "1",
      "12",
      "112",
      "213",
      "214",
      ...Array.from({ length: READER_PAGE_LIST_SEARCH_THRESHOLD - 7 }, (_, index) =>
        String(300 + index),
      ),
    ];
    const pageReferences = labels.map((label, index) => pageReference(`page-${index + 1}`, label));
    const { container } = renderPanel(navigation({ pageReferences }));
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;

    expect(search.getAttribute("placeholder")).toBe("Find page");
    setSearchValue(search, "iv");
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Book pages"] button')].map(
        (button) => button.textContent?.trim(),
      ),
    ).toEqual(["IV"]);

    setSearchValue(search, "21");
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Book pages"] button')].map(
        (button) => button.textContent?.trim(),
      ),
    ).toEqual(["213", "214"]);
  });

  it("preserves independent Contents and Page List queries while switching collections", () => {
    const chapters = Array.from({ length: 13 }, (_, index) =>
      chapter(`chapter-${index + 1}`, index === 12 ? "Appendix Notes" : `Chapter ${index + 1}`),
    );
    const pageReferences = Array.from(
      { length: READER_PAGE_LIST_SEARCH_THRESHOLD + 1 },
      (_, index) =>
        pageReference(
          `page-${index + 1}`,
          index === READER_PAGE_LIST_SEARCH_THRESHOLD ? "xii" : String(index + 1),
        ),
    );
    const { container } = renderPanel(navigation({ chapters, pageReferences }));
    let search = container.querySelector<HTMLInputElement>('input[type="search"]')!;

    setSearchValue(search, "appendix");
    expect(container.querySelectorAll(".reader-navigation__chapter")).toHaveLength(1);

    clickButtonByText(container, "Pages");
    search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(search.value).toBe("");
    expect(container.querySelectorAll('nav[aria-label="Book pages"] button')).toHaveLength(
      READER_PAGE_LIST_SEARCH_THRESHOLD + 1,
    );
    setSearchValue(search, "XII");
    expect(container.querySelectorAll('nav[aria-label="Book pages"] button')).toHaveLength(1);

    clickButtonByText(container, "Contents");
    search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(search.value).toBe("appendix");
    expect(container.querySelectorAll(".reader-navigation__chapter")).toHaveLength(1);

    clickButtonByText(container, "Pages");
    search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(search.value).toBe("XII");
    expect(container.querySelectorAll('nav[aria-label="Book pages"] button')).toHaveLength(1);
  });

  it("shows the current Page List query in the no-results state and clears back to publisher pages", () => {
    const pageReferences = Array.from(
      { length: READER_PAGE_LIST_SEARCH_THRESHOLD + 1 },
      (_, index) => pageReference(`page-${index + 1}`, String(index + 1)),
    );
    const { container } = renderPanel(navigation({ pageReferences }));
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;

    setSearchValue(search, "not-a-page");
    expect(container.querySelector(".reader-navigation__no-results")?.textContent).toContain(
      "No page labels match “not-a-page”",
    );
    expect(container.querySelector('nav[aria-label="Book pages"]')).toBeNull();

    clickButtonByText(container, "Clear search");
    expect(search.value).toBe("");
    expect(container.querySelectorAll('nav[aria-label="Book pages"] button')).toHaveLength(
      READER_PAGE_LIST_SEARCH_THRESHOLD + 1,
    );
  });

  it("navigates a filtered page reference through the existing navigation item callback", async () => {
    const pageReferences = Array.from(
      { length: READER_PAGE_LIST_SEARCH_THRESHOLD + 1 },
      (_, index) =>
        pageReference(
          `page-${index + 1}`,
          index === READER_PAGE_LIST_SEARCH_THRESHOLD ? "213" : String(index + 1),
        ),
    );
    const { container, onClose, onNavigate } = renderPanel(navigation({ pageReferences }));
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;

    setSearchValue(search, "213");
    const result = container.querySelector<HTMLButtonElement>(
      'nav[aria-label="Book pages"] button',
    );
    expect(result?.textContent?.trim()).toBe("213");

    await act(async () => {
      result?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith(`page-${READER_PAGE_LIST_SEARCH_THRESHOLD + 1}`);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reveals the current Contents item inside the panel without moving the Reader viewport", () => {
    const broadScroll = vi.fn(() => {
      document.documentElement.scrollTop = 900;
    });
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: broadScroll,
    });
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("reader-navigation__body")) {
          return new DOMRect(0, 100, 380, 200);
        }
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
      const { container, onNavigate } = renderPanel(
        navigation({ chapters, currentChapterId: "chapter-8" }),
      );
      const body = container.querySelector<HTMLElement>(".reader-navigation__body")!;

      expect(body.scrollTop).toBe(158);
      expect(document.documentElement.scrollTop).toBe(0);
      expect(broadScroll).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      bounds.mockRestore();
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  it("publishes an ordinary empty state without synthesizing collections", () => {
    const { container } = renderPanel(navigation());

    expect(container.textContent).toContain("No book navigation");
    expect(container.querySelectorAll(".reader-navigation__collection")).toHaveLength(0);
    expect(container.querySelector('nav[aria-label="Book chapters"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="Book landmarks"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="Book pages"]')).toBeNull();
  });

  it("keeps a failed destination open and reports the failure", async () => {
    const { container, onClose } = renderPanel(
      navigation({ landmarks: [landmark("landmark-cover", "Cover", "cover")] }),
      { onNavigate: async () => false },
    );
    const cover = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Cover"),
    );

    await act(async () => {
      cover?.click();
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be opened");
  });
});
