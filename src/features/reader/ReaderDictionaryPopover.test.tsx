// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DictionaryDefinitionEntry } from "../../types/dictionary";
import { resetTransientSurfaceOwnershipForTests } from "../../utils/transientSurfaceOwnership";
import { ReaderDictionaryPopover } from "./ReaderDictionaryPopover";
import type { ClientRect, HighlightPaletteAnchor } from "./readerHighlightPaletteAnchor";
import type { ReaderDictionaryLookupState } from "./useReaderDictionaryLookup";

const RECT: ClientRect = {
  bottom: 140,
  height: 20,
  left: 120,
  right: 220,
  top: 120,
  width: 100,
};
const VIEWPORT: ClientRect = {
  bottom: 700,
  height: 700,
  left: 0,
  right: 900,
  top: 0,
  width: 900,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  resetTransientSurfaceOwnershipForTests();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function entry(
  dictionaryId: string,
  dictionaryName: string,
  displayHeadword: string,
  definitionTextBlocks: readonly string[],
  sourceAttribution = `${dictionaryName} source`,
): DictionaryDefinitionEntry {
  return {
    definitionTextBlocks,
    dictionaryId,
    dictionaryName,
    displayHeadword,
    sourceAttribution,
  };
}

function state(
  status: ReaderDictionaryLookupState["status"],
  overrides: Partial<ReaderDictionaryLookupState> = {},
): ReaderDictionaryLookupState {
  return {
    error: null,
    requestRevision: 1,
    results: [],
    selectedTerm: "example",
    selectionOwner: null,
    status,
    truncated: false,
    ...overrides,
  };
}

function mountPopover(
  currentState: ReaderDictionaryLookupState,
  options: {
    anchor?: HighlightPaletteAnchor;
    onDismiss?: () => void;
    onRetry?: () => void;
    popoverSize?: Readonly<{ height: number; width: number }>;
    viewport?: ClientRect;
  } = {},
) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const viewer = document.body.appendChild(document.createElement("div"));
  vi.spyOn(viewer, "getBoundingClientRect").mockReturnValue(
    (options.viewport ?? VIEWPORT) as DOMRect,
  );
  const focusTarget = document.body.appendChild(document.createElement("button"));
  focusTarget.textContent = "Reader content";
  const anchor =
    options.anchor ??
    ({ document, focusTarget, resolveRect: () => RECT } satisfies HighlightPaletteAnchor);
  const onDismiss = options.onDismiss ?? vi.fn();
  const onRetry = options.onRetry ?? vi.fn();
  if (options.popoverSize) {
    const { height, width } = options.popoverSize;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("reader-dictionary-popover")
        ? new DOMRect(0, 0, width, height)
        : new DOMRect();
    });
  }
  const render = (nextState: ReaderDictionaryLookupState) => {
    act(() => {
      root?.render(
        <ReaderDictionaryPopover
          anchor={anchor}
          initialAnchorRect={RECT}
          onDismiss={onDismiss}
          onRetry={onRetry}
          state={nextState}
          viewerRef={{ current: viewer }}
        />,
      );
    });
  };
  render(currentState);
  return { anchor, focusTarget, onDismiss, onRetry, render, viewer };
}

describe("ReaderDictionaryPopover", () => {
  it("constrains its rendered box to a smaller offset Reader viewport", () => {
    const viewport: ClientRect = {
      bottom: 400,
      height: 300,
      left: 300,
      right: 620,
      top: 100,
      width: 320,
    };
    const anchorRect: ClientRect = {
      bottom: 150,
      height: 20,
      left: 430,
      right: 490,
      top: 130,
      width: 60,
    };
    const focusTarget = document.body.appendChild(document.createElement("button"));
    const anchor = {
      document,
      focusTarget,
      resolveRect: () => anchorRect,
    } satisfies HighlightPaletteAnchor;

    mountPopover(state("ready", { results: [entry("a", "Dictionary", "Example", ["Text"])] }), {
      anchor,
      popoverSize: { height: 180, width: 296 },
      viewport,
    });

    const popover = container!.querySelector<HTMLElement>(".reader-dictionary-popover")!;
    const content = container!.querySelector<HTMLElement>(".reader-dictionary-popover__content")!;
    const left = Number.parseFloat(popover.style.left);
    const top = Number.parseFloat(popover.style.top);
    const width = Number.parseFloat(popover.style.width);
    const maxHeight = Number.parseFloat(popover.style.maxHeight);

    expect({ left, maxHeight, top, width }).toEqual({
      left: 312,
      maxHeight: 276,
      top: 160,
      width: 296,
    });
    expect(popover.dataset.placement).toBe("below");
    expect(popover.style.height).toBe("");
    expect(left).toBeGreaterThanOrEqual(viewport.left + 12);
    expect(left + width).toBeLessThanOrEqual(viewport.right - 12);
    expect(top).toBeGreaterThanOrEqual(viewport.top + 12);
    expect(top + 180).toBeLessThanOrEqual(viewport.bottom - 12);
    expect(content.parentElement).toBe(popover);
    expect(content.tabIndex).toBe(0);
    expect(content.getAttribute("role")).toBe("region");
  });

  it("renders loading, no-results, and recoverable error states", () => {
    const rendered = mountPopover(state("looking-up"));
    expect(container?.querySelector('[role="status"]')?.textContent).toContain(
      "Looking up definition",
    );

    rendered.render(state("no-results"));
    expect(container?.querySelector('[role="status"]')?.textContent).toBe("No definitions found.");

    rendered.render(state("error", { error: "Dictionary data is unavailable." }));
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "Dictionary data is unavailable.",
    );
    act(() =>
      Array.from(container?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent?.trim() === "Try again")
        ?.click(),
    );
    expect(rendered.onRetry).toHaveBeenCalledOnce();
  });

  it("preserves dictionary and entry order while rendering definition blocks as safe text", () => {
    const markup = '<img src=x onerror="window.__unsafe = true">';
    mountPopover(
      state("ready", {
        results: [
          entry("dict-b", "Second configured dictionary", "Example", [markup, "Second sense"]),
          entry("dict-b", "Second configured dictionary", "Examples", ["Plural sense"]),
          entry("dict-a", "Later configured dictionary", "Example", ["Later definition"]),
        ],
      }),
    );

    const groups = Array.from(
      container?.querySelectorAll<HTMLElement>(".reader-dictionary-popover__group") ?? [],
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]?.querySelector("h3")?.textContent).toBe("Second configured dictionary");
    expect(groups[1]?.querySelector("h3")?.textContent).toBe("Later configured dictionary");
    expect(
      Array.from(groups[0]?.querySelectorAll("h4") ?? [], (heading) => heading.textContent),
    ).toEqual(["Example", "Examples"]);
    expect(groups[0]?.textContent).toContain(markup);
    expect(groups[0]?.querySelector("img")).toBeNull();
  });

  it("suppresses only adjacent case-insensitive duplicate headwords within each dictionary", () => {
    mountPopover(
      state("ready", {
        results: [
          entry("dict-a", "First dictionary", "School", ["First definition"]),
          entry("dict-a", "First dictionary", "school", ["Second definition"]),
          entry("dict-a", "First dictionary", "Schoolhouse", ["Third definition"]),
          entry("dict-a", "First dictionary", "SCHOOLHOUSE", ["Fourth definition"]),
          entry("dict-a", "First dictionary", "school", ["Fifth definition"]),
          entry("dict-b", "Second dictionary", "school", ["Sixth definition"]),
        ],
      }),
    );

    const groups = Array.from(
      container?.querySelectorAll<HTMLElement>(".reader-dictionary-popover__group") ?? [],
    );
    expect(groups).toHaveLength(2);
    expect(
      Array.from(groups[0]?.querySelectorAll("h4") ?? [], (heading) => heading.textContent),
    ).toEqual(["School", "Schoolhouse", "school"]);
    expect(
      Array.from(groups[0]?.querySelectorAll("article") ?? [], (article) => article.textContent),
    ).toEqual([
      "SchoolFirst definition",
      "Second definition",
      "SchoolhouseThird definition",
      "Fourth definition",
      "schoolFifth definition",
    ]);
    expect(
      Array.from(groups[1]?.querySelectorAll("h4") ?? [], (heading) => heading.textContent),
    ).toEqual(["school"]);
    expect(groups[1]?.querySelector("article")?.textContent).toBe("schoolSixth definition");
  });

  it("presents each dictionary source after its definitions without displacing the selected term", () => {
    const openEnglishName = "Open English WordNet 2025 with an intentionally long source name";
    const sources = [
      "GNU Collaborative International Dictionary of English",
      "Princeton University WordNet 3.0",
      "Open English WordNet contributors and lexicographer community",
    ];
    mountPopover(
      state("ready", {
        selectedTerm: "school",
        results: [
          entry("gcide", "GCIDE", "School", ["GCIDE definition"], sources[0]),
          entry("wordnet", "Princeton WordNet 3.0", "school", ["WordNet definition"], sources[1]),
          entry("oewn", openEnglishName, "school", ["Open English WordNet definition"], sources[2]),
        ],
      }),
    );

    expect(container?.querySelector(".reader-dictionary-popover__header h2")?.textContent).toBe(
      "school",
    );
    const groups = Array.from(
      container?.querySelectorAll<HTMLElement>(".reader-dictionary-popover__group") ?? [],
    );
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.querySelector("h3")?.textContent)).toEqual([
      "GCIDE",
      "Princeton WordNet 3.0",
      openEnglishName,
    ]);
    expect(groups.map((group) => group.querySelector("h3")?.title)).toEqual([
      "GCIDE",
      "Princeton WordNet 3.0",
      openEnglishName,
    ]);

    groups.forEach((group, index) => {
      const provenance = group.querySelector<HTMLElement>(".reader-dictionary-popover__source");
      expect(provenance?.textContent).toBe(`Source ${sources[index]}`);
      expect(provenance?.title).toBe(`Source ${sources[index]}`);
      expect(group.lastElementChild).toBe(provenance);
      expect(group.querySelector("article")?.textContent).toContain("definition");
    });
  });

  it("owns scrolling focus and restores the Reader anchor after Escape", () => {
    container = document.body.appendChild(document.createElement("div"));
    const viewer = document.body.appendChild(document.createElement("div"));
    vi.spyOn(viewer, "getBoundingClientRect").mockReturnValue(VIEWPORT as DOMRect);
    const focusTarget = document.body.appendChild(document.createElement("button"));
    focusTarget.textContent = "Reader content";
    const anchor: HighlightPaletteAnchor = {
      document,
      focusTarget,
      resolveRect: () => RECT,
    };

    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <ReaderDictionaryPopover
          anchor={anchor}
          initialAnchorRect={RECT}
          onDismiss={() => setOpen(false)}
          onRetry={vi.fn()}
          state={state("ready", {
            results: [entry("dict-a", "Dictionary", "Example", ["Definition ".repeat(300)])],
          })}
          viewerRef={{ current: viewer }}
        />
      ) : null;
    }

    root = createRoot(container);
    act(() => root?.render(<Harness />));
    const popover = container.querySelector<HTMLElement>(".reader-dictionary-popover")!;
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close definition"]')!;
    const content = container.querySelector<HTMLElement>('[aria-label="Dictionary definitions"]')!;
    expect(document.activeElement).toBe(close);
    expect(content.tabIndex).toBe(0);

    act(() => content.focus());
    act(() =>
      content.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" }),
      ),
    );
    expect(document.activeElement).toBe(close);

    act(() =>
      popover.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      ),
    );
    expect(container.querySelector(".reader-dictionary-popover")).toBeNull();
    expect(document.activeElement).toBe(focusTarget);
  });

  it("dismisses an outside pointer without stealing the user's new focus", () => {
    const rendered = mountPopover(state("ready", { results: [entry("a", "A", "A", ["A"])] }));
    const outside = document.body.appendChild(document.createElement("button"));
    act(() => outside.focus());
    act(() => outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));

    expect(rendered.onDismiss).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(outside);
  });
});
