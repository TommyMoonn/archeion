// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import { LibraryStorageContext } from "../../storage/useLibraryStorage";
import type { Book } from "../../types/book";
import type { EpubDiagnosticAnalysisResult } from "../../types/epubIntegrity";
import { LibraryEpubIssuesView, type LibraryEpubIssuesViewProps } from "./LibraryEpubIssuesView";

const modifiedAt = Date.parse("2026-08-13T00:00:00.000Z");

function book(id: string, title: string): Book {
  return {
    addedAt: "2026-01-01T00:00:00.000Z",
    fileName: `${id}.epub`,
    id,
    isFavorite: false,
    modifiedAt: new Date(modifiedAt).toISOString(),
    originalTitle: title,
    relativePath: `Shelf/${id}.epub`,
    size: 128,
    sourceMetadata: { creator: "Ada", title },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const readable = book("readable", "Readable with warning");
const blocked = book("blocked", "Unreadable archive");
const mixed = book("mixed", "Mixed diagnostics");

function analysis(
  requestRevision = 1,
  order: readonly Book[] = [readable, blocked, mixed],
): EpubDiagnosticAnalysisResult {
  return {
    archiveGeneration: 1,
    entries: order.map((candidate) => ({
      diagnostics: {
        formatVersion: 1,
        issues:
          candidate.id === "blocked"
            ? [{ code: "inspection-limit-exceeded" as const, severity: "error" as const }]
            : candidate.id === "mixed"
              ? [
                  { code: "unreadable-zip" as const, severity: "error" as const },
                  {
                    code: "broken-local-document-target" as const,
                    messageInputs: { href: "missing.xhtml" },
                    resourcePath: "OPS/chapter.xhtml",
                    severity: "warning" as const,
                  },
                ]
              : [
                  {
                    code: "broken-local-document-target" as const,
                    messageInputs: { href: "missing.xhtml" },
                    resourcePath: "OPS/chapter.xhtml",
                    severity: "warning" as const,
                  },
                ],
      },
      relativePath: candidate.relativePath!,
      signature: { modifiedAtMillis: modifiedAt, sizeBytes: candidate.size! },
      source: "computed" as const,
    })),
    requestRevision,
  };
}

const storage = {
  loadBookCover: vi.fn().mockResolvedValue(undefined),
} as unknown as LibraryStorage;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function defaultProps(
  overrides: Partial<LibraryEpubIssuesViewProps> = {},
): LibraryEpubIssuesViewProps {
  return {
    books: [readable, blocked, mixed],
    onOpenDetails: vi.fn(),
    onRead: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue(true),
    onReveal: vi.fn(),
    state: { error: null, snapshot: analysis(), status: "ready" },
    ...overrides,
  };
}

async function renderView(props: LibraryEpubIssuesViewProps): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LibraryStorageContext.Provider value={storage}>
        <LibraryEpubIssuesView {...props} />
      </LibraryStorageContext.Provider>,
    );
  });
  return container;
}

function buttonWithText(rootElement: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(rootElement.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("LibraryEpubIssuesView", () => {
  it("summarizes affected books, discloses details, and routes current book actions", async () => {
    const props = defaultProps();
    const rendered = await renderView(props);
    const readableRow = rendered.querySelector<HTMLElement>('[data-reader-book-id="readable"]')!;
    const blockedRow = rendered.querySelector<HTMLElement>('[data-reader-book-id="blocked"]')!;

    const mixedRow = rendered.querySelector<HTMLElement>('[data-reader-book-id="mixed"]')!;

    expect(rendered.textContent).toContain("3 affected books");
    expect(rendered.textContent).not.toContain(
      "Inspect Reader-relevant problems without changing EPUB files.",
    );
    expect(readableRow.querySelector('[data-severity="warning"]')?.textContent).toBe("1 warning");
    expect(blockedRow.querySelector('[data-severity="error"]')?.textContent).toBe("1 error");
    expect(blockedRow.querySelector(".epub-issues-book__reader-status")?.textContent).toBe(
      "Reader unavailable",
    );
    expect(mixedRow.querySelector('[data-severity="error"]')?.textContent).toBe("1 error");
    expect(mixedRow.querySelector('[data-severity="warning"]')?.textContent).toBe("1 warning");
    expect(mixedRow.querySelector(".epub-issues-book__reader-status")?.textContent).toBe(
      "Reader unavailable",
    );
    expect(
      readableRow
        .querySelector(".epub-issues-book__summary")
        ?.getAttribute("data-reader-available"),
    ).toBe("true");
    expect(
      blockedRow.querySelector(".epub-issues-book__summary")?.getAttribute("data-reader-available"),
    ).toBe("false");
    const summary = readableRow.querySelector<HTMLElement>("summary")!;
    summary.focus();
    expect(document.activeElement).toBe(summary);
    await act(async () => summary.click());
    expect(readableRow.querySelector("details")?.open).toBe(true);
    expect(readableRow.textContent).toContain("missing.xhtml");
    expect(readableRow.textContent).toContain("OPS/chapter.xhtml");

    await act(async () => {
      readableRow
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open details for Readable with warning"]',
        )
        ?.click();
      buttonWithText(readableRow, "Readable with warning")?.click();
      buttonWithText(readableRow, "Read")?.click();
      buttonWithText(readableRow, "Reveal")?.click();
    });
    expect(props.onRead).toHaveBeenCalledWith(readable);
    expect(props.onOpenDetails).toHaveBeenCalledTimes(2);
    expect(props.onOpenDetails).toHaveBeenNthCalledWith(1, readable);
    expect(props.onOpenDetails).toHaveBeenNthCalledWith(2, readable);
    expect(props.onReveal).toHaveBeenCalledWith(readable);
    expect(readableRow.querySelector(".epub-issues-book__header")?.textContent).toContain("Read");
    expect(readableRow.querySelector(".epub-issues-book__header")?.textContent).toContain("Reveal");
    expect(readableRow.querySelector(":scope > .epub-issues-book__actions")).toBeNull();
    expect(
      blockedRow.querySelector('[data-issue-code="inspection-limit-exceeded"]'),
    ).not.toBeNull();
    expect(buttonWithText(blockedRow, "Read")?.getAttribute("aria-disabled")).toBe("true");
    expect(buttonWithText(readableRow, "Read")?.getAttribute("aria-disabled")).toBeNull();
  });

  it("publishes replacement diagnostics through Refresh", async () => {
    function Harness() {
      const [state, setState] = useState(defaultProps().state);
      return (
        <LibraryEpubIssuesView
          {...defaultProps()}
          state={state}
          onRefresh={async () => {
            setState({ error: null, snapshot: analysis(2, [blocked, readable]), status: "ready" });
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

    await act(async () => buttonWithText(container!, "Refresh")?.click());

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-reader-book-id]"),
        (row) => row.dataset.readerBookId,
      ),
    ).toEqual(["blocked", "readable"]);
  });

  it("distinguishes an initial failure from a successful empty result", async () => {
    const onRefresh = vi.fn().mockResolvedValue(true);
    const rendered = await renderView(
      defaultProps({
        onRefresh,
        state: {
          error: { message: "Diagnostics failed.", operation: "diagnostics" },
          snapshot: null,
          status: "error",
        },
      }),
    );

    expect(rendered.textContent).toContain("EPUB Issues unavailable");
    expect(rendered.textContent).toContain("Diagnostics failed.");
    expect(rendered.textContent).not.toContain("No EPUB issues");
    await act(async () => buttonWithText(rendered, "Try again")?.click());
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps a prior snapshot visible when Refresh fails", async () => {
    const rendered = await renderView(
      defaultProps({
        state: {
          error: { message: "Refresh failed.", operation: "diagnostics" },
          snapshot: analysis(),
          status: "error",
        },
      }),
    );

    expect(rendered.textContent).toContain("Refresh failed.");
    expect(rendered.querySelectorAll("[data-reader-book-id]")).toHaveLength(3);
  });
});
