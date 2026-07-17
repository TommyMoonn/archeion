// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryView } from "../../types/library";
import {
  calculateAnchoredViewportStart,
  useLibraryCollectionWindow,
  type LibraryCollectionLayout,
} from "./useLibraryCollectionWindow";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: Root | null = null;

function Harness({
  layout,
  restorationIndex,
  view,
}: {
  layout: LibraryCollectionLayout;
  restorationIndex?: number;
  view: LibraryView;
}) {
  const { collectionRef, range } = useLibraryCollectionWindow(500, view, restorationIndex);
  return (
    <section
      ref={collectionRef}
      data-testid="collection"
      data-window-end={range.end}
      data-window-start={range.start}
      style={{
        columnGap: layout.rowGap,
        display: "grid",
        gridTemplateColumns: Array.from({ length: layout.columns }, () => "1fr").join(" "),
        rowGap: layout.rowGap,
      }}
    >
      {Array.from({ length: range.end - range.start }, (_, offset) => (
        <article
          data-library-index={range.start + offset}
          data-reader-book-id={`book-${range.start + offset}`}
          key={range.start + offset}
          style={{ height: layout.itemHeight }}
        >
          <button type="button">Book {range.start + offset}</button>
        </article>
      ))}
    </section>
  );
}

function StatefulHarness({ initial }: { initial: LibraryCollectionLayout }) {
  const [layout, setLayout] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setLayout({ columns: 3, itemHeight: 410, rowGap: 24 })}>
        Resize
      </button>
      <Harness layout={layout} view="grid" />
    </>
  );
}

function RestorationHarness() {
  const [restorationIndex, setRestorationIndex] = useState<number>();
  return (
    <>
      <button type="button" onClick={() => setRestorationIndex(300)}>
        Restore
      </button>
      <Harness
        layout={{ columns: 5, itemHeight: 300, rowGap: 28 }}
        restorationIndex={restorationIndex}
        view="grid"
      />
    </>
  );
}

async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  });
}

async function nextMeasurement(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  });
}

function installResizeObserverHarness() {
  const observers: Array<{
    callback: ResizeObserverCallback;
    instance: ResizeObserver;
    targets: Set<Element>;
  }> = [];

  class TestResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>();

    constructor(callback: ResizeObserverCallback) {
      const record = {
        callback,
        instance: this,
        targets: this.targets,
      };
      observers.push(record);
    }

    disconnect(): void {
      this.targets.clear();
    }

    observe(target: Element): void {
      this.targets.add(target);
    }

    unobserve(target: Element): void {
      this.targets.delete(target);
    }
  }

  vi.stubGlobal("ResizeObserver", TestResizeObserver);

  return {
    notify(target: Element, width: number, height: number) {
      const contentRect = {
        bottom: height,
        height,
        left: 0,
        right: width,
        top: 0,
        width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRectReadOnly;
      for (const observer of observers) {
        if (!observer.targets.has(target)) continue;
        observer.callback([{ target, contentRect } as ResizeObserverEntry], observer.instance);
      }
    },
  };
}

function rect(top: number, height: number, width: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: width,
    top,
    width,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const element = this as HTMLElement;
    const scrollRoot = element.closest<HTMLElement>(".page-shell");
    const height = element.matches("[data-reader-book-id]")
      ? Number.parseFloat(element.style.height)
      : element.classList.contains("page-shell")
        ? 600
        : 0;
    const top = element.dataset.testid === "collection" ? -(scrollRoot?.scrollTop ?? 0) : 0;
    return {
      bottom: top + height,
      height,
      left: 0,
      right: 1_000,
      top,
      width: 1_000,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("page-shell") ? 600 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1_000);
});

afterEach(() => {
  if (activeRoot) act(() => activeRoot?.unmount());
  activeRoot = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mounted library collection window", () => {
  it("does not correct or drift ordinary grid scrolling under unchanged geometry", async () => {
    const scrollRoot = document.createElement("div");
    scrollRoot.className = "page-shell";
    document.body.append(scrollRoot);
    activeRoot = createRoot(scrollRoot);
    await act(async () => {
      activeRoot?.render(
        <Harness layout={{ columns: 5, itemHeight: 300, rowGap: 28 }} view="grid" />,
      );
    });
    await nextMeasurement();

    scrollRoot.scrollTop = 315;
    scrollRoot.dispatchEvent(new Event("scroll"));
    await nextMeasurement();
    expect(scrollRoot.scrollTop).toBe(315);

    scrollRoot.dispatchEvent(new Event("scroll"));
    await nextMeasurement();
    expect(scrollRoot.scrollTop).toBe(315);
  });

  it("anchors a genuine grid column and row-geometry change exactly once", async () => {
    const previous = { columns: 5, itemHeight: 300, rowGap: 28 };
    const next = { columns: 3, itemHeight: 410, rowGap: 24 };
    const scrollRoot = document.createElement("div");
    scrollRoot.className = "page-shell";
    document.body.append(scrollRoot);
    activeRoot = createRoot(scrollRoot);
    await act(async () => activeRoot?.render(<StatefulHarness initial={previous} />));
    await nextMeasurement();
    scrollRoot.scrollTop = 10 * 328 + 37;
    scrollRoot.dispatchEvent(new Event("scroll"));
    await nextMeasurement();

    await act(async () => {
      scrollRoot.querySelector<HTMLButtonElement>("button")?.click();
    });
    await nextMeasurement();
    const anchored = calculateAnchoredViewportStart(10 * 328 + 37, previous, next);
    expect(scrollRoot.scrollTop).toBe(anchored);

    await nextMeasurement();
    expect(scrollRoot.scrollTop).toBe(anchored);
  });

  it("does not synchronously remeasure when only the retained range changes", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
      this: HTMLElement,
    ) {
      const element = this as HTMLElement;
      const scrollRoot = element.closest<HTMLElement>(".page-shell");
      const index = Number(element.dataset.libraryIndex);
      const height = element.matches("[data-reader-book-id]")
        ? index % 2 === 0
          ? 110
          : 100
        : element.classList.contains("page-shell")
          ? 600
          : 0;
      const top = element.dataset.testid === "collection" ? -(scrollRoot?.scrollTop ?? 0) : 0;
      return {
        bottom: top + height,
        height,
        left: 0,
        right: 1_000,
        top,
        width: 1_000,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const scrollRoot = document.createElement("div");
    scrollRoot.className = "page-shell";
    scrollRoot.scrollTop = 1_450;
    document.body.append(scrollRoot);
    activeRoot = createRoot(scrollRoot);

    await act(async () => {
      activeRoot?.render(
        <Harness layout={{ columns: 1, itemHeight: 75, rowGap: 0 }} view="list" />,
      );
    });

    expect(
      scrollRoot.querySelector<HTMLElement>("[data-library-index]")?.dataset.libraryIndex,
    ).toBe("9");
  });

  it("never applies grid anchoring to list scrolling", async () => {
    const scrollRoot = document.createElement("div");
    scrollRoot.className = "page-shell";
    document.body.append(scrollRoot);
    activeRoot = createRoot(scrollRoot);
    await act(async () => {
      activeRoot?.render(
        <Harness layout={{ columns: 1, itemHeight: 75, rowGap: 0 }} view="list" />,
      );
    });
    await nextMeasurement();

    scrollRoot.scrollTop = 315;
    scrollRoot.dispatchEvent(new Event("scroll"));
    await nextMeasurement();
    expect(scrollRoot.scrollTop).toBe(315);
  });

  it("mounts an explicitly requested offscreen restoration row without unbounding the window", async () => {
    const scrollRoot = document.createElement("div");
    scrollRoot.className = "page-shell";
    document.body.append(scrollRoot);
    activeRoot = createRoot(scrollRoot);
    await act(async () => activeRoot?.render(<RestorationHarness />));
    await nextMeasurement();
    expect(scrollRoot.querySelector("[data-reader-book-id='book-300']")).toBeNull();

    await act(async () => scrollRoot.querySelector<HTMLButtonElement>("button")?.click());
    await nextMeasurement();

    expect(scrollRoot.querySelector("[data-reader-book-id='book-300']")).not.toBeNull();
    expect(scrollRoot.scrollTop).toBeGreaterThan(0);
    expect(scrollRoot.querySelectorAll("[data-reader-book-id]").length).toBeLessThan(50);
  });

  it("pre-retains the next row when keyboard focus reaches a retained edge", async () => {
    const scrollRoot = document.createElement("div");
    scrollRoot.className = "page-shell";
    document.body.append(scrollRoot);
    activeRoot = createRoot(scrollRoot);
    await act(async () => {
      activeRoot?.render(
        <Harness layout={{ columns: 5, itemHeight: 300, rowGap: 28 }} view="grid" />,
      );
    });
    await nextMeasurement();
    const before = [...scrollRoot.querySelectorAll<HTMLElement>("[data-library-index]")];
    const lastIndex = Number(before.at(-1)?.dataset.libraryIndex);

    before.at(-1)?.querySelector<HTMLButtonElement>("button")?.focus();
    await nextMeasurement();

    expect(scrollRoot.querySelector(`[data-library-index="${lastIndex + 1}"]`)).not.toBeNull();
  });

  it.each([
    ["grid", { columns: 5, itemHeight: 300, rowGap: 28 }, 60],
    ["list", { columns: 1, itemHeight: 75, rowGap: 0 }, 30],
  ] as const)(
    "keeps repeated upward %s scrolling monotonic across retained boundaries",
    async (view, layout, mountLimit) => {
      const resizeObserver = installResizeObserverHarness();
      const scrollRoot = document.createElement("div");
      scrollRoot.className = "page-shell";
      document.body.append(scrollRoot);
      activeRoot = createRoot(scrollRoot);
      await act(async () => activeRoot?.render(<Harness layout={layout} view={view} />));

      const collection = scrollRoot.querySelector<HTMLElement>("[data-testid='collection']")!;
      let previousStart = Number.POSITIVE_INFINITY;
      for (const gestureTop of [3_200, 2_800, 2_400, 2_000, 1_600]) {
        scrollRoot.scrollTop = gestureTop;
        scrollRoot.dispatchEvent(new Event("scroll"));
        resizeObserver.notify(collection, 1_000, 50_000 + gestureTop);
        await nextFrame();

        const currentStart = Number(collection.dataset.windowStart);
        expect(scrollRoot.scrollTop).toBe(gestureTop);
        expect(currentStart).toBeLessThanOrEqual(previousStart);
        expect(scrollRoot.querySelectorAll("[data-reader-book-id]").length).toBeLessThan(
          mountLimit,
        );
        previousStart = currentStart;
      }

      expect(previousStart).toBeLessThan(Number(collection.dataset.windowEnd));
    },
  );

  it("uses visible stable geometry instead of the first overscanned item", async () => {
    let itemGeometryReads = 0;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
      this: HTMLElement,
    ) {
      const element = this as HTMLElement;
      const scrollRoot = element.closest<HTMLElement>(".page-shell");
      if (element.classList.contains("page-shell")) {
        return rect(0, 600, 1_000);
      }
      if (element.dataset.testid === "collection") {
        return rect(-(scrollRoot?.scrollTop ?? 0), 0, 1_000);
      }
      if (element.matches("[data-reader-book-id]")) {
        itemGeometryReads += 1;
        const index = Number(element.dataset.libraryIndex);
        const firstRetainedIndex = Number(
          element.parentElement?.querySelector<HTMLElement>("[data-library-index]")?.dataset
            .libraryIndex,
        );
        const top = index * 75 - (scrollRoot?.scrollTop ?? 0);
        const height = index === firstRetainedIndex ? 110 : 75;
        return rect(top, height, 1_000);
      }
      return rect(0, 0, 1_000);
    });

    const scrollRoot = document.createElement("div");
    scrollRoot.className = "page-shell";
    scrollRoot.scrollTop = 1_450;
    document.body.append(scrollRoot);
    activeRoot = createRoot(scrollRoot);
    await act(async () => {
      activeRoot?.render(
        <Harness layout={{ columns: 1, itemHeight: 75, rowGap: 0 }} view="list" />,
      );
    });

    const collection = scrollRoot.querySelector<HTMLElement>("[data-testid='collection']")!;
    itemGeometryReads = 0;
    scrollRoot.scrollTop = 1_600;
    scrollRoot.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(itemGeometryReads).toBe(0);
    expect(scrollRoot.scrollTop).toBe(1_600);
    expect(collection.dataset.windowStart).toBe("15");
    const stableStart = collection.dataset.windowStart;
    await nextFrame();
    await nextFrame();
    expect(collection.dataset.windowStart).toBe(stableStart);
  });

  it("updates an ordinary scroll frame from cached geometry only", async () => {
    let itemGeometryReads = 0;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
      this: HTMLElement,
    ) {
      const element = this as HTMLElement;
      if (element.matches("[data-reader-book-id]")) itemGeometryReads += 1;
      const scrollRoot = element.closest<HTMLElement>(".page-shell");
      const height = element.matches("[data-reader-book-id]")
        ? Number.parseFloat(element.style.height)
        : element.classList.contains("page-shell")
          ? 600
          : 0;
      const top = element.dataset.testid === "collection" ? -(scrollRoot?.scrollTop ?? 0) : 0;
      return rect(top, height, 1_000);
    });

    const scrollRoot = document.createElement("div");
    scrollRoot.className = "page-shell";
    let scrollTop = 0;
    let scrollWrites = 0;
    Object.defineProperty(scrollRoot, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
        scrollWrites += 1;
      },
    });
    document.body.append(scrollRoot);
    activeRoot = createRoot(scrollRoot);
    await act(async () => {
      activeRoot?.render(
        <Harness layout={{ columns: 5, itemHeight: 300, rowGap: 28 }} view="grid" />,
      );
    });

    const collection = scrollRoot.querySelector<HTMLElement>("[data-testid='collection']")!;
    const initialStart = Number(collection.dataset.windowStart);
    const computedStyle = vi.spyOn(window, "getComputedStyle");
    itemGeometryReads = 0;
    scrollTop = 3_200;
    scrollWrites = 0;
    scrollRoot.dispatchEvent(new Event("scroll"));
    await nextFrame();

    expect(Number(collection.dataset.windowStart)).toBeGreaterThan(initialStart);
    expect(itemGeometryReads).toBe(0);
    expect(computedStyle).not.toHaveBeenCalled();
    expect(scrollWrites).toBe(0);
    expect(scrollRoot.scrollTop).toBe(3_200);
  });

  it("filters resize notifications by their geometry ownership", async () => {
    const resizeObserver = installResizeObserverHarness();
    let rootHeight = 600;
    const rootWidth = 1_000;
    let collectionWidth = 1_000;
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("page-shell") ? rootHeight : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("page-shell")) return rootWidth;
      if (this.dataset.testid === "collection") return collectionWidth;
      return 1_000;
    });
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
      this: HTMLElement,
    ) {
      const element = this as HTMLElement;
      const scrollRoot = element.closest<HTMLElement>(".page-shell");
      if (element.classList.contains("page-shell")) return rect(0, rootHeight, rootWidth);
      if (element.dataset.testid === "collection") {
        return rect(-(scrollRoot?.scrollTop ?? 0), 0, collectionWidth);
      }
      const height = element.matches("[data-reader-book-id]")
        ? Number.parseFloat(element.style.height)
        : 0;
      return rect(0, height, collectionWidth);
    });

    const previous = { columns: 5, itemHeight: 300, rowGap: 28 };
    const next = { columns: 3, itemHeight: 410, rowGap: 24 };
    const scrollRoot = document.createElement("div");
    scrollRoot.className = "page-shell";
    let scrollTop = 0;
    let scrollWrites = 0;
    Object.defineProperty(scrollRoot, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
        scrollWrites += 1;
      },
    });
    document.body.append(scrollRoot);
    activeRoot = createRoot(scrollRoot);
    await act(async () => activeRoot?.render(<StatefulHarness initial={previous} />));

    const collection = scrollRoot.querySelector<HTMLElement>("[data-testid='collection']")!;
    const computedStyle = vi.spyOn(window, "getComputedStyle");
    const initialEnd = Number(collection.dataset.windowEnd);
    computedStyle.mockClear();
    resizeObserver.notify(collection, collectionWidth, 50_000);
    await nextFrame();
    expect(computedStyle).not.toHaveBeenCalled();

    rootHeight = 900;
    resizeObserver.notify(scrollRoot, rootWidth, rootHeight);
    await nextFrame();
    expect(Number(collection.dataset.windowEnd)).toBeGreaterThan(initialEnd);

    scrollTop = 10 * 328 + 37;
    scrollWrites = 0;
    scrollRoot.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await act(async () => scrollRoot.querySelector<HTMLButtonElement>("button")?.click());
    collectionWidth = 700;
    resizeObserver.notify(collection, collectionWidth, 50_000);
    await nextFrame();

    const anchored = calculateAnchoredViewportStart(10 * 328 + 37, previous, next);
    expect(scrollRoot.scrollTop).toBe(anchored);
    expect(scrollWrites).toBe(1);

    scrollWrites = 0;
    resizeObserver.notify(collection, collectionWidth, 50_000);
    await nextFrame();
    expect(scrollRoot.scrollTop).toBe(anchored);
    expect(scrollWrites).toBe(0);
  });
});
