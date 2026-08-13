// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import type { Book } from "../../types/book";
import type { EpubDuplicateAnalysisResult } from "../../types/epubIntegrity";
import { TooltipProvider } from "../../components/Tooltip";
import { LibraryDuplicatesView, type LibraryDuplicatesViewProps } from "./LibraryDuplicatesView";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const modifiedAt = Date.parse("2026-08-01T09:30:00.000Z");

function book(
  id: string,
  relativePath: string,
  title: string,
  creator: string,
  identifier?: string,
): Book {
  return {
    addedAt: "2026-01-01T00:00:00.000Z",
    fileName: relativePath.split("/").at(-1) ?? relativePath,
    id,
    isFavorite: false,
    modifiedAt: new Date(modifiedAt).toISOString(),
    originalTitle: title,
    relativePath,
    size: id === "book-a" ? 1_048_576 : 2_097_152,
    sourceMetadata: { creator, identifier, title },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const alpha = book("book-a", "Authors/Alpha.epub", "Alpha", "Ada", "urn:shared");
const alphaCopy = book("book-b", "Backups/Alpha.epub", "Alpha copy", "Ada", "urn:shared");
const beta = book("book-c", "Authors/Beta.epub", "Beta", "Bea", "urn:other");
const betaCopy = book("book-d", "Backups/Beta.epub", "Beta copy", "Bea", "urn:other");
const books = [alpha, alphaCopy, beta, betaCopy];

function signature(sizeBytes: number) {
  return { modifiedAtMillis: modifiedAt, sizeBytes };
}

function analysis(groups: EpubDuplicateAnalysisResult["groups"]): EpubDuplicateAnalysisResult {
  return {
    archiveGeneration: 1,
    groups,
    requestRevision: 1,
    signatures: {
      [alpha.relativePath!]: signature(alpha.size!),
      [alphaCopy.relativePath!]: signature(alphaCopy.size!),
      [beta.relativePath!]: signature(beta.size!),
      [betaCopy.relativePath!]: signature(betaCopy.size!),
    },
  };
}

const exactGroup = {
  identity: "sha256:1234567890abcdefghijklmnopqrstuvwxyz",
  kind: "exact" as const,
  members: [alpha.relativePath!, alphaCopy.relativePath!],
};
const probableGroup = {
  identity: "urn:shared",
  kind: "probable" as const,
  members: [beta.relativePath!, betaCopy.relativePath!],
};

const storage = {
  loadBookCover: vi.fn().mockResolvedValue(undefined),
} as unknown as LibraryStorage;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function defaultProps(
  overrides: Partial<LibraryDuplicatesViewProps> = {},
): LibraryDuplicatesViewProps {
  return {
    books,
    onDelete: vi.fn(),
    onMove: vi.fn(),
    onOpenDetails: vi.fn(),
    onRead: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue(true),
    onReveal: vi.fn(),
    state: {
      error: null,
      snapshot: analysis([exactGroup, probableGroup]),
      status: "ready",
    },
    ...overrides,
  };
}

async function renderView(props: LibraryDuplicatesViewProps) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LibraryStorageContext.Provider value={storage}>
        <TooltipProvider>
          <LibraryDuplicatesView {...props} />
        </TooltipProvider>
      </LibraryStorageContext.Provider>,
    );
  });
  return container;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("LibraryDuplicatesView", () => {
  it("renders exact and probable groups with decision-useful member identity", async () => {
    const rendered = await renderView(defaultProps());
    const groups = rendered.querySelectorAll<HTMLElement>(".duplicate-group");

    expect(Array.from(groups, (group) => group.dataset.duplicateKind)).toEqual([
      "exact",
      "probable",
    ]);
    expect(groups[0]?.textContent).toContain("Exact duplicate");
    expect(groups[0]?.textContent).toContain("Digest");
    expect(groups[1]?.textContent).not.toContain("Probable match");
    expect(groups[1]?.textContent).toContain("EPUB identifier");
    expect(groups[1]?.textContent).toContain("urn:shared");
    expect(rendered.textContent).toContain("Authors/Alpha.epub");
    expect(rendered.textContent).toContain("1.0 MB");
    expect(rendered.textContent).toContain("Ada");
    expect(rendered.textContent).not.toContain("Review matches before changing archive files.");

    const alphaTitle = rendered.querySelector<HTMLElement>(
      '[data-reader-book-id="book-a"] .duplicate-member__identity strong',
    );
    const tooltipId = alphaTitle?.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    expect(document.getElementById(tooltipId!)?.textContent).toBe("Alpha");

    const overflow = rendered.querySelector<HTMLButtonElement>(
      'button[aria-label="File actions for Alpha"]',
    );
    expect(overflow?.textContent).not.toContain("More");
    expect(overflow?.querySelector("svg")).not.toBeNull();
  });

  it("targets the current member through existing read, details, reveal, move, and delete adapters", async () => {
    const props = defaultProps();
    const rendered = await renderView(props);
    const alphaRow = rendered.querySelector<HTMLElement>('[data-reader-book-id="book-a"]')!;

    await act(async () => {
      alphaRow
        .querySelector<HTMLButtonElement>('button[aria-label="Open details for Alpha"]')
        ?.click();
      Array.from(alphaRow.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Read")
        ?.click();
      Array.from(alphaRow.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Reveal")
        ?.click();
    });
    expect(props.onOpenDetails).toHaveBeenCalledWith(alpha);
    expect(props.onRead).toHaveBeenCalledWith(alpha);
    expect(props.onReveal).toHaveBeenCalledWith(alpha);

    await act(async () => {
      alphaRow
        .querySelector<HTMLButtonElement>('button[aria-label="File actions for Alpha"]')
        ?.click();
    });
    const move = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.includes("Move to folder"),
    );
    await act(async () => move?.click());
    expect(props.onMove).toHaveBeenCalledWith(alpha);

    await act(async () => {
      alphaRow
        .querySelector<HTMLButtonElement>('button[aria-label="File actions for Alpha"]')
        ?.click();
    });
    const remove = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Delete EPUB"));
    await act(async () => remove?.click());
    expect(props.onDelete).toHaveBeenCalledWith(alpha);
  });

  it("publishes refreshed groups in stable result order", async () => {
    function Harness() {
      const [state, setState] = useState(defaultProps().state);
      return (
        <LibraryDuplicatesView
          {...defaultProps()}
          state={state}
          onRefresh={async () => {
            setState({
              error: null,
              snapshot: analysis([probableGroup, exactGroup]),
              status: "ready",
            });
            return true;
          }}
        />
      );
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <LibraryStorageContext.Provider value={storage}>
          <Harness />
        </LibraryStorageContext.Provider>,
      );
    });

    await act(async () => {
      Array.from(container!.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Refresh")
        ?.click();
    });

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(".duplicate-group"),
        (group) => group.dataset.duplicateKind,
      ),
    ).toEqual(["probable", "exact"]);
  });

  it("drops a settled moved or removed member and preserves usable keyboard actions", async () => {
    const props = defaultProps({ books: [alpha, alphaCopy] });
    const rendered = await renderView(props);
    const details = rendered.querySelector<HTMLButtonElement>(
      'button[aria-label="Open details for Alpha"]',
    )!;
    const menuTrigger = rendered.querySelector<HTMLButtonElement>(
      'button[aria-label="File actions for Alpha"]',
    )!;

    details.focus();
    expect(document.activeElement).toBe(details);
    expect(details.tabIndex).toBe(0);
    await act(async () => {
      menuTrigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
      );
    });
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");

    await act(async () => {
      root?.render(
        <LibraryStorageContext.Provider value={storage}>
          <LibraryDuplicatesView {...props} books={[alphaCopy]} />
        </LibraryStorageContext.Provider>,
      );
    });
    expect(rendered.querySelector(".duplicate-group")).toBeNull();
    expect(rendered.textContent).toContain("No duplicate groups");
  });

  it("shows a recoverable error without claiming that the analysis found no groups", async () => {
    const onRefresh = vi.fn().mockResolvedValue(true);
    const rendered = await renderView(
      defaultProps({
        onRefresh,
        state: {
          error: {
            message: "Duplicate analysis could not be refreshed.",
            operation: "duplicates",
          },
          snapshot: null,
          status: "error",
        },
      }),
    );

    expect(rendered.textContent).toContain("Duplicates unavailable");
    expect(rendered.textContent).not.toContain("No duplicate groups");
    expect(rendered.textContent).not.toContain("0 groups");
    await act(async () => {
      Array.from(rendered.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Try again")
        ?.click();
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
