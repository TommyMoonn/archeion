// @vitest-environment happy-dom

import { act, useLayoutEffect, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../../types/book";
import type { Annotation } from "../../types/annotation";

vi.mock("./readerAnnotationExportFile", () => ({
  exportReaderAnnotationsToFile: vi.fn(),
}));

import { exportReaderAnnotationsToFile } from "./readerAnnotationExportFile";
import { useReaderAnnotationExport } from "./useReaderAnnotationExport";

type ExportApi = ReturnType<typeof useReaderAnnotationExport>;

const book: Book = {
  addedAt: "2026-07-14T00:00:00.000Z",
  fileName: "book.epub",
  id: "book-1",
  isFavorite: false,
  originalAuthor: "Author One",
  originalTitle: "Book One",
  sourceMetadata: { creator: "Author One", title: "Book One" },
  updatedAt: "2026-07-14T00:00:00.000Z",
};
const annotation: Annotation = {
  cfiRange: "epubcfi(/6/2)",
  createdAt: "2026-07-14T00:00:00.000Z",
  id: "bookmark-1",
  label: "Opening",
  type: "bookmark",
  updatedAt: "2026-07-14T00:00:00.000Z",
};
const chapters = [
  {
    depth: 0,
    href: "chapter.xhtml",
    id: "chapter",
    label: "Chapter One",
    position: {},
    target: "chapter.xhtml",
  },
] as const;

function Harness({
  annotations,
  apiRef,
  currentBook,
}: {
  annotations: readonly Annotation[];
  apiRef: MutableRefObject<ExportApi | undefined>;
  currentBook?: Book;
}) {
  const annotationExport = useReaderAnnotationExport({
    annotations,
    book: currentBook,
    chapters,
  });
  useLayoutEffect(() => {
    apiRef.current = annotationExport;
  }, [annotationExport, apiRef]);
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderHarness(
  apiRef: MutableRefObject<ExportApi | undefined>,
  currentBook?: Book,
  annotations: readonly Annotation[] = [annotation],
) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () =>
    root?.render(<Harness annotations={annotations} apiRef={apiRef} currentBook={currentBook} />),
  );
}

beforeEach(() => {
  vi.mocked(exportReaderAnnotationsToFile).mockReset().mockResolvedValue({
    annotationCount: 1,
    bookCount: 1,
    path: "C:\\Exports\\book-one-annotations.md",
    status: "saved",
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("useReaderAnnotationExport", () => {
  it("exports the current book with its latest annotations and chapter labels", async () => {
    const apiRef = { current: undefined } as MutableRefObject<ExportApi | undefined>;
    await renderHarness(apiRef, book);
    await act(async () => {
      await apiRef.current?.exportCurrentAnnotations("markdown");
    });

    expect(exportReaderAnnotationsToFile).toHaveBeenCalledWith({
      books: [
        {
          annotations: [annotation],
          author: "Author One",
          chapters,
          id: book.id,
          title: "Book One",
        },
      ],
      format: "markdown",
    });
  });

  it("returns empty without opening file export when no book is active", async () => {
    const apiRef = { current: undefined } as MutableRefObject<ExportApi | undefined>;
    await renderHarness(apiRef);
    expect(await apiRef.current?.exportCurrentAnnotations("json")).toEqual({ status: "empty" });
    expect(exportReaderAnnotationsToFile).not.toHaveBeenCalled();
  });

  it("uses the latest collection without recreating the command callback", async () => {
    const second = { ...annotation, id: "bookmark-2", label: "Second" };
    const apiRef = { current: undefined } as MutableRefObject<ExportApi | undefined>;
    await renderHarness(apiRef, book);
    const exportCommand = apiRef.current?.exportCurrentAnnotations;
    await renderHarness(apiRef, book, [annotation, second]);
    expect(apiRef.current?.exportCurrentAnnotations).toBe(exportCommand);

    await apiRef.current?.exportCurrentAnnotations("json");
    expect(
      vi.mocked(exportReaderAnnotationsToFile).mock.calls[0]?.[0].books[0]?.annotations,
    ).toEqual([annotation, second]);
  });
});
