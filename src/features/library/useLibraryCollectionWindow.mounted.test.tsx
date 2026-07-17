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

async function nextMeasurement(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  });
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
});
