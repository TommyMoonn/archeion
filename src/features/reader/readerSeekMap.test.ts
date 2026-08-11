import type { Book as EpubBook } from "epubjs";
import { describe, expect, it, vi } from "vitest";

import { emptyReaderNavigationModel, type ReaderNavigationModel } from "./readerNavigationModel";
import {
  createReaderSeekMap,
  READER_SEEK_LOCATION_BREAK,
  type ReaderSeekMapReadyState,
  type ReaderSeekMapState,
} from "./readerSeekMap";

function locations(
  generated: readonly string[] = [
    "epubcfi(/6/2!/4/2:0)",
    "epubcfi(/6/4!/4/2:0)",
    "epubcfi(/6/6!/4/2:0)",
  ],
) {
  const values = [...generated];
  return {
    cfiFromPercentage: vi.fn((percentage: number) => {
      if (percentage <= 0) return values[0] ?? "";
      if (percentage >= 1) return values.at(-1) ?? "";
      return values[Math.ceil((values.length - 1) * percentage)] ?? "";
    }),
    generate: vi.fn(async () => values),
    percentageFromCfi: vi.fn((cfi: string) => {
      const index = values.indexOf(cfi);
      return index < 0 || values.length <= 1 ? 0 : index / (values.length - 1);
    }),
  } as Pick<EpubBook["locations"], "cfiFromPercentage" | "generate" | "percentageFromCfi">;
}

function ready(state: ReaderSeekMapState): ReaderSeekMapReadyState {
  if (state.status !== "ready") throw new Error("Expected a ready seek map.");
  return state;
}

describe("Reader seek map", () => {
  it("generates the active EPUB location map and resolves representative normalized percentages", async () => {
    const epubLocations = locations();
    const seekMap = createReaderSeekMap(epubLocations, () => emptyReaderNavigationModel);

    expect(seekMap.getState()).toEqual({ status: "pending" });

    await seekMap.generate();

    expect(epubLocations.generate).toHaveBeenCalledWith(READER_SEEK_LOCATION_BREAK);
    const state = ready(seekMap.getState());
    expect(state.resolveCfi(0)).toBe("epubcfi(/6/2!/4/2:0)");
    expect(state.resolveCfi(0.5)).toBe("epubcfi(/6/4!/4/2:0)");
    expect(state.resolveCfi(1)).toBe("epubcfi(/6/6!/4/2:0)");
    expect(state.resolveCfi(-10)).toBe("epubcfi(/6/2!/4/2:0)");
    expect(state.resolveCfi(10)).toBe("epubcfi(/6/6!/4/2:0)");
    expect(state.resolvePercentage("epubcfi(/6/4!/4/2:0)")).toBe(0.5);
  });

  it("resolves preview chapter labels through the current navigation model", async () => {
    const epubLocations = locations();
    let navigationModel: ReaderNavigationModel = emptyReaderNavigationModel;
    const seekMap = createReaderSeekMap(epubLocations, () => navigationModel);
    await seekMap.generate();
    const state = ready(seekMap.getState());
    const cfi = "epubcfi(/6/4!/4/2:0)";

    expect(state.resolveChapterLabel(cfi)).toBeUndefined();

    navigationModel = {
      ...emptyReaderNavigationModel,
      findNearestChapter: (candidate) =>
        candidate === cfi
          ? {
              depth: 0,
              href: "Text/chapter-2.xhtml",
              id: "chapter-2",
              label: "Chapter Two",
              position: { cfi },
              target: cfi,
            }
          : undefined,
    };

    expect(state.resolveChapterLabel(cfi)).toBe("Chapter Two");
  });

  it("exposes unavailable state when generation fails or yields no usable locations", async () => {
    const failingLocations = locations();
    vi.mocked(failingLocations.generate).mockRejectedValueOnce(
      new Error("location generation failed"),
    );
    const failedMap = createReaderSeekMap(failingLocations, () => emptyReaderNavigationModel);

    await expect(failedMap.generate()).resolves.toBeUndefined();
    expect(failedMap.getState()).toEqual({ status: "unavailable" });

    const emptyMap = createReaderSeekMap(locations([]), () => emptyReaderNavigationModel);
    await emptyMap.generate();
    expect(emptyMap.getState()).toEqual({ status: "unavailable" });
  });

  it("retires ready operations with the owning EPUB session", async () => {
    const seekMap = createReaderSeekMap(locations(), () => emptyReaderNavigationModel);
    await seekMap.generate();
    const readyState = ready(seekMap.getState());

    seekMap.retire();

    expect(seekMap.getState()).toEqual({ status: "pending" });
    expect(readyState.resolveCfi(0.5)).toBeUndefined();
    expect(readyState.resolvePercentage("epubcfi(/6/4!/4/2:0)")).toBeUndefined();
    expect(readyState.resolveChapterLabel("epubcfi(/6/4!/4/2:0)")).toBeUndefined();
  });
});
