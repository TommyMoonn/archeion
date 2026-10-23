// @vitest-environment happy-dom

import { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryView } from "../../types/library";
import {
  calculateAnchoredViewportStart,
  useLibraryCollectionWindow,
  type LibraryCollectionLayout,
  type LibraryReturnFocusRequest,
} from "./useLibraryCollectionWindow";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: Root | null = null;

function Harness({
  layout,
  restorationIndex,
  view,
  returnRequest,
  itemCount = 500,
  onCommit,
}: {
  layout: LibraryCollectionLayout;
  restorationIndex?: number;
  view: LibraryView;
  returnRequest?: LibraryReturnFocusRequest;
  itemCount?: number;
  onCommit?: (value: { start: number; end: number; preparing: boolean }) => void;
}) {
  const { collectionRef, range, preparingReturn } = useLibraryCollectionWindow(
    itemCount,
    view,
    restorationIndex,
    returnRequest,
  );
  useLayoutEffect(() => {
    onCommit?.({ start: range.start, end: range.end, preparing: preparingReturn });
  }, [onCommit, preparingReturn, range]);
  return (
    <section
      ref={collectionRef}
      data-testid="collection"
      data-window-end={range.end}
      data-window-start={range.start}
      data-return-preparing={preparingReturn || undefined}
      inert={preparingReturn || undefined}
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
  it("reveals a bounded safe fallback when row geometry remains unavailable", async () => {
    const root = document.createElement("main");
    root.className = "page-shell";
    document.body.append(root);
    activeRoot = createRoot(root);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 0, 1000, 0),
    );
    const unavailable = vi.fn();
    const ready = vi.fn();
    await act(async () =>
      activeRoot?.render(
        <Harness
          view="list"
          layout={{ columns: 1, itemHeight: 75, rowGap: 0 }}
          restorationIndex={300}
          returnRequest={{
            bookId: "book-300",
            index: 300,
            anchor: { viewportY: 100, scrollTop: 10000 },
            onTargetReady: ready,
            onUnavailable: unavailable,
          }}
        />,
      ),
    );
    expect(root.querySelector("[data-return-preparing]")).not.toBeNull();
    for (let frame = 0; frame < 13; frame++) await nextFrame();
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
    expect(root.scrollTop).toBe(0);
    expect(root.querySelector("[data-return-preparing]")).toBeNull();
  });
  it.each([48, 49, 500, 3000])(
    "retains the target in the first preparing commit at %i books",
    async (itemCount) => {
      const root = document.createElement("main");
      root.className = "page-shell";
      document.body.append(root);
      activeRoot = createRoot(root);
      const index = Math.floor(itemCount / 2);
      const commits: { start: number; end: number; preparing: boolean }[] = [];
      await act(async () =>
        activeRoot?.render(
          <Harness
            view="grid"
            itemCount={itemCount}
            layout={{ columns: 5, itemHeight: 300, rowGap: 28 }}
            restorationIndex={index}
            returnRequest={{
              bookId: `book-${index}`,
              index,
              anchor: { viewportY: 120, scrollTop: 1 },
              onTargetReady: vi.fn(),
            }}
            onCommit={(value) => commits.push(value)}
          />,
        ),
      );
      expect(commits[0]?.preparing).toBe(true);
      expect(commits[0]!.start).toBeLessThanOrEqual(index);
      expect(commits[0]!.end).toBeGreaterThan(index);
    },
  );
  it.each([false, true])(
    "waits for entrance completion and fences a cancelled animation wait (%s)",
    async (cancelled) => {
      const root = document.createElement("main");
      root.className = "page-shell library-content--books";
      document.body.append(root);
      let finish!: () => void;
      const animation = {
        playState: "running",
        pending: false,
        finished: new Promise<void>((resolve) => {
          finish = resolve;
        }),
      };
      Object.defineProperty(root, "getAnimations", { value: () => [animation] });
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
        this: HTMLElement,
      ) {
        return new DOMRect(
          0,
          this.hasAttribute("data-reader-book-id") ? -root.scrollTop : 0,
          1000,
          300,
        );
      });
      const ready = vi.fn();
      activeRoot = createRoot(root);
      await act(async () =>
        activeRoot?.render(
          <Harness
            view="grid"
            layout={{ columns: 5, itemHeight: 300, rowGap: 28 }}
            restorationIndex={300}
            returnRequest={{
              bookId: "book-300",
              index: 300,
              anchor: { viewportY: -120, scrollTop: 1 },
              onTargetReady: ready,
            }}
          />,
        ),
      );
      expect(ready).not.toHaveBeenCalled();
      expect(root.scrollTop).toBe(120);
      if (cancelled) act(() => document.dispatchEvent(new Event("wheel")));
      await act(async () => {
        animation.playState = "finished";
        finish();
        await Promise.resolve();
      });
      await nextFrame();
      await nextFrame();
      if (cancelled) {
        expect(ready).not.toHaveBeenCalled();
        expect(root.scrollTop).toBe(120);
      } else {
        expect(ready).toHaveBeenCalled();
        expect(root.scrollTop).toBeGreaterThan(0);
      }
    },
  );

  it.each(["grid", "list"] as const)(
    "owns %s return geometry through delayed measurement and releases on input",
    async (view) => {
      const root = document.createElement("main");
      root.className = "page-shell";
      document.body.append(root);
      activeRoot = createRoot(root);
      let height = 300;
      let columns = view === "grid" ? 5 : 1;
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
        this: HTMLElement,
      ) {
        const index = this.dataset.libraryIndex;
        const top =
          index === undefined
            ? this.dataset.testid === "collection"
              ? -root.scrollTop
              : 0
            : Math.floor(Number(index) / columns) * height - root.scrollTop;
        return {
          top,
          bottom: top + height,
          height,
          left: 0,
          right: 1000,
          width: 1000,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      });
      const ready = vi.fn();
      const request: LibraryReturnFocusRequest = {
        bookId: "book-300",
        index: 300,
        anchor: { scrollTop: 9, viewportY: 120 },
        onTargetReady: ready,
      };
      const render = (returnRequest?: LibraryReturnFocusRequest) =>
        act(async () =>
          activeRoot?.render(
            <Harness
              layout={{ columns, itemHeight: height, rowGap: 0 }}
              restorationIndex={returnRequest?.index}
              returnRequest={returnRequest}
              view={view}
            />,
          ),
        );
      await render(request);
      await nextFrame();
      await nextFrame();
      expect(ready).toHaveBeenCalled();
      expect(root.scrollTop).toBe((300 / columns) * height - 120);
      expect(root.style.overflowAnchor).toBe("none");
      await render();
      height = 340;
      await render();
      await nextMeasurement();
      expect(root.scrollTop).toBe((300 / columns) * height - 120);
      if (view === "grid") {
        columns = 4;
        await render();
        await nextMeasurement();
        expect(root.scrollTop).toBe((300 / columns) * height - 120);
      }
      act(() => document.dispatchEvent(new Event("wheel")));
      expect(root.style.overflowAnchor).toBe("");
      root.scrollTop = 200;
      root.dispatchEvent(new Event("scroll"));
      await nextFrame();
      expect(root.scrollTop).toBe(200);
    },
  );

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
