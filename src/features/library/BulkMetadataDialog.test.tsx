// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import { BulkMetadataDialog } from "./BulkMetadataDialog";

let root: Root | null = null;

function createBook(id: string, series: string): Book {
  return {
    id,
    fileName: `${id}.epub`,
    relativePath: `${id}.epub`,
    originalTitle: id,
    sourceMetadata: { series, publisher: "Shared Press", subjects: ["Fantasy"] },
    isFavorite: false,
    addedAt: "1",
    updatedAt: "1",
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(container: HTMLElement, text: string) {
  const match = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!match) throw new Error(`Button not found: ${text}`);
  return match;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("BulkMetadataDialog", () => {
  it("exposes the unavailable Review changes reason while blocking activation", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <BulkMetadataDialog
          books={[createBook("One", "First")]}
          onApply={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />,
      );
    });

    const review = button(container, "Review changes");
    const reasonId = review.getAttribute("aria-describedby")!;
    act(() => {
      review.focus();
      review.click();
    });

    expect(review.disabled).toBe(false);
    expect(review.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(reasonId)?.textContent).toBe(
      "Choose at least one metadata field.",
    );
    expect(document.activeElement).toBe(review);
    expect(container.textContent).not.toContain("Review metadata changes");
  });

  it("shows mixed values, previews each book, and applies only enabled fields", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onApply = vi.fn(async () => undefined);
    act(() => {
      root?.render(
        <BulkMetadataDialog
          books={[createBook("One", "First"), createBook("Two", "Second")]}
          onApply={onApply}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Mixed values");
    const seriesToggle = container.querySelector<HTMLInputElement>(
      '.bulk-metadata-field input[type="checkbox"]',
    )!;
    const seriesInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="New series"]',
    )!;
    act(() => {
      seriesToggle.click();
      setInputValue(seriesInput, "Shared Series");
    });
    const seriesHelpId = seriesInput.getAttribute("aria-describedby");
    expect(seriesHelpId).toBe("bulk-metadata-series-help");
    expect(document.getElementById(seriesHelpId!)?.textContent).toBe(
      "Leave blank to clear this field.",
    );
    act(() => button(container, "Review changes").click());

    expect(container.textContent).toContain("First");
    expect(container.textContent).toContain("Second");
    expect(container.textContent).toContain("Shared Series");
    await act(async () => button(container, "Update 2 EPUBs").click());
    expect(onApply).toHaveBeenCalledWith({ series: "Shared Series" });
  });

  it("preserves commas within a tag and renders separate preview values unambiguously", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const commaSubjectBook = {
      ...createBook("One", "Series"),
      sourceMetadata: {
        publisher: "Shared Press",
        series: "Series",
        subjects: ["Science, Technology"],
      },
    };
    act(() => {
      root?.render(
        <BulkMetadataDialog
          books={[commaSubjectBook]}
          onApply={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Use one tag per line. Commas remain part of the tag.");
    const tagToggle = container.querySelector<HTMLInputElement>(
      '.bulk-metadata-field--tags input[type="checkbox"]',
    )!;
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Tags to apply"]',
    )!;
    expect(textarea.getAttribute("aria-describedby")).toBe("bulk-metadata-subjects-help");
    expect(
      container
        .querySelector('[role="radiogroup"][aria-label="Tag operation"]')
        ?.getAttribute("aria-describedby"),
    ).toBe("bulk-metadata-subjects-help");
    act(() => {
      tagToggle.click();
      setTextareaValue(textarea, "Science\r\nTechnology");
    });
    act(() => button(container, "Review changes").click());

    const previewValues = [
      ...container.querySelectorAll<HTMLElement>('[data-multiline="true"]'),
    ].map((element) => element.textContent);
    expect(previewValues).toEqual(["“Science, Technology”", "“Science”\n“Technology”"]);
  });

  it("keeps sustained writes inside the loaded review dialog", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onApply = vi.fn(async () => undefined);
    const books = [createBook("One", "First")];

    act(() => {
      root?.render(<BulkMetadataDialog books={books} onApply={onApply} onClose={vi.fn()} />);
    });

    const seriesToggle = container.querySelector<HTMLInputElement>(
      '.bulk-metadata-field input[type="checkbox"]',
    )!;
    const seriesInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="New series"]',
    )!;
    act(() => {
      seriesToggle.click();
      setInputValue(seriesInput, "Shared Series");
    });
    act(() => button(container, "Review changes").click());

    act(() => {
      root?.render(
        <BulkMetadataDialog books={books} isWriting onApply={onApply} onClose={vi.fn()} />,
      );
    });

    const writing = button(container, "Writing metadata");
    const back = button(container, "Back");
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    expect(container.querySelector(".dialog-loading-fallback")).toBeNull();
    expect(writing.disabled).toBe(true);
    expect(back.disabled).toBe(true);
    act(() => writing.click());
    expect(onApply).not.toHaveBeenCalled();
  });

  it("confirms before discarding actual field intent", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onClose = vi.fn();
    act(() => {
      root?.render(
        <BulkMetadataDialog
          books={[createBook("One", "Series")]}
          onApply={vi.fn(async () => undefined)}
          onClose={onClose}
        />,
      );
    });

    act(() => button(container, "Cancel").click());
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    act(() => {
      container
        .querySelector<HTMLInputElement>('.bulk-metadata-field input[type="checkbox"]')
        ?.click();
      button(container, "Cancel").click();
    });
    expect(container.textContent).toContain("Discard metadata changes?");
    expect(onClose).not.toHaveBeenCalled();

    act(() => button(container, "Discard changes").click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
