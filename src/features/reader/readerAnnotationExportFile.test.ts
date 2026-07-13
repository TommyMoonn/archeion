import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  exportReaderAnnotationsToFile,
  normalizeAnnotationExportPath,
} from "./readerAnnotationExportFile";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

const book = {
  annotations: [
    {
      cfiRange: "epubcfi(/6/2)",
      createdAt: "2026-07-01T00:00:00.000Z",
      id: "bookmark-1",
      type: "bookmark" as const,
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  ],
  id: "book-1",
  title: "Book One",
};

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(save).mockReset().mockResolvedValue("C:\\Exports\\book-one-annotations.md");
});

describe("exportReaderAnnotationsToFile", () => {
  it("requires the requested extension without changing the selected path", () => {
    expect(normalizeAnnotationExportPath("C:\\Exports\\notes.MD", "markdown")).toBe(
      "C:\\Exports\\notes.MD",
    );
    expect(normalizeAnnotationExportPath("C:\\Exports\\notes.JsOn", "json")).toBe(
      "C:\\Exports\\notes.JsOn",
    );
    expect(() => normalizeAnnotationExportPath("C:\\Exports\\notes", "markdown")).toThrow(
      "Markdown exports require a .md file name.",
    );
    expect(() => normalizeAnnotationExportPath("C:\\Exports\\notes.txt", "json")).toThrow(
      "JSON exports require a .json file name.",
    );
  });

  it("does not open a misleading file for an empty export", async () => {
    await expect(
      exportReaderAnnotationsToFile({ books: [{ ...book, annotations: [] }], format: "json" }),
    ).resolves.toEqual({ status: "empty" });
    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("treats save-dialog cancellation as a non-write", async () => {
    vi.mocked(save).mockResolvedValueOnce(null);
    await expect(
      exportReaderAnnotationsToFile({ books: [book], format: "markdown" }),
    ).resolves.toEqual({ status: "cancelled" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("writes the complete document before reporting success", async () => {
    const result = await exportReaderAnnotationsToFile({
      books: [book],
      exportedAt: "2026-07-13T12:00:00.000Z",
      format: "markdown",
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "book-one-annotations.md",
        title: "Export annotations",
      }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "write_annotation_export_file",
      expect.objectContaining({
        contents: expect.stringContaining("# Archeion annotations"),
        format: "markdown",
        path: "C:\\Exports\\book-one-annotations.md",
      }),
    );
    expect(result).toEqual({
      annotationCount: 1,
      bookCount: 1,
      path: "C:\\Exports\\book-one-annotations.md",
      status: "saved",
    });
  });

  it.each([
    ["markdown" as const, "C:\\Exports\\annotations.json", "Markdown"],
    ["json" as const, "C:\\Exports\\annotations.md", "JSON"],
    ["markdown" as const, "C:\\Exports\\annotations.txt", "Markdown"],
    ["json" as const, "C:\\Exports\\annotations", "JSON"],
  ])(
    "rejects %s export to an incompatible path before invoking native IO",
    async (format, path, label) => {
      vi.mocked(save).mockResolvedValueOnce(path);

      await expect(exportReaderAnnotationsToFile({ books: [book], format })).rejects.toThrow(
        `${label} exports require`,
      );
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("writes JSON only to a JSON path", async () => {
    vi.mocked(save).mockResolvedValueOnce("C:\\Exports\\book-one-annotations.JSON");

    await exportReaderAnnotationsToFile({
      books: [book],
      exportedAt: "2026-07-13T12:00:00.000Z",
      format: "json",
    });

    expect(invoke).toHaveBeenCalledWith(
      "write_annotation_export_file",
      expect.objectContaining({
        contents: expect.stringContaining('"schema": "archeion.annotation-export"'),
        format: "json",
        path: "C:\\Exports\\book-one-annotations.JSON",
      }),
    );
  });

  it("does not report success when the native write fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Disk full"));
    await expect(
      exportReaderAnnotationsToFile({ books: [book], format: "markdown" }),
    ).rejects.toThrow("Disk full");
  });
});
