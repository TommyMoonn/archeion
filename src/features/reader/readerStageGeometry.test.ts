// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { observeReaderStageSize, syncReaderRenditionStageSize } from "./readerStageGeometry";

const readerStyles = readFileSync(resolve(process.cwd(), "src/styles/features/reader.css"), "utf8");

describe("Reader stage geometry", () => {
  it("resizes an active rendition through epub.js instead of patching view DOM", () => {
    const resize = vi.fn();
    const rendition = { resize } as unknown as Parameters<typeof syncReaderRenditionStageSize>[0];

    syncReaderRenditionStageSize(rendition, { height: 720, width: 1080 });

    expect(resize).toHaveBeenCalledOnce();
    expect(resize).toHaveBeenCalledWith(1080, 720);
  });

  it("preserves the canonical CFI when epub.js relays out an active rendition", () => {
    const resize = vi.fn();
    const rendition = { resize } as unknown as Parameters<typeof syncReaderRenditionStageSize>[0];

    syncReaderRenditionStageSize(rendition, { height: 668, width: 960 }, "epubcfi(/6/2!/4/8:8)");

    expect(resize).toHaveBeenCalledWith(960, 668, "epubcfi(/6/2!/4/8:8)");
  });

  it("observes one deduplicated, non-zero Reader-stage size", () => {
    const stage = document.createElement("div");
    let rect = new DOMRect(0, 0, 960, 720);
    stage.getBoundingClientRect = vi.fn(() => rect);
    const observed: Array<{ height: number; width: number }> = [];
    const observerCallbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    const observe = vi.fn();
    const OriginalResizeObserver = globalThis.ResizeObserver;

    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        observerCallbacks.push(callback);
      }
      disconnect = disconnect;
      observe = observe;
      unobserve = vi.fn();
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    try {
      const stop = observeReaderStageSize(stage, (size) => observed.push(size));
      expect(observed).toEqual([{ height: 720, width: 960 }]);
      expect(observe).toHaveBeenCalledWith(stage);

      observerCallbacks[0]?.([], {} as ResizeObserver);
      expect(observed).toHaveLength(1);

      rect = new DOMRect(0, 0, 1180, 760);
      observerCallbacks[0]?.([], {} as ResizeObserver);
      expect(observed).toEqual([
        { height: 720, width: 960 },
        { height: 760, width: 1180 },
      ]);

      rect = new DOMRect(0, 0, 0, 0);
      observerCallbacks[0]?.([], {} as ResizeObserver);
      expect(observed).toHaveLength(2);

      stop();
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });

  it("reserves measured Reader chrome in the host layout and bounds paged hit areas to that viewport", () => {
    expect(readerStyles).toMatch(
      /\.reader-page\[data-toolbar-expanded\]\s*\{[^}]*--reader-header-clearance:\s*var\(--reader-toolbar-height\)/s,
    );
    expect(readerStyles).toMatch(
      /\.reader-toolbar\s*\{[^}]*min-height:\s*var\(--reader-toolbar-min-height\)/s,
    );
    expect(readerStyles).toMatch(
      /\.reader-page\s*\{[^}]*padding-block-start:\s*var\(--reader-header-clearance\)/s,
    );

    const viewerRule = readerStyles.match(/\.epub-viewer\s*\{([^}]*)\}/s)?.[1] ?? "";
    expect(viewerRule).not.toMatch(/margin-block-start/);
    expect(viewerRule).not.toMatch(/padding-block-start/);

    expect(readerStyles).toMatch(/\.epub-viewer__click-zone\s*\{[^}]*top:\s*0;[^}]*bottom:\s*0;/s);
  });
});
