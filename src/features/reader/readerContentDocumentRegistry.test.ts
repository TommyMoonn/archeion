// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultReaderSettings } from "../../types/reader";
import { createReaderContentTheme } from "./readerTheme";
import { ReaderContentDocumentRegistry } from "./readerContentDocumentRegistry";

function mountedFrame(): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  Object.defineProperty(frame.contentWindow, "frameElement", {
    configurable: true,
    value: frame,
  });
  return frame;
}

describe("ReaderContentDocumentRegistry", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("binds an exact document once and removes every listener through one cleanup", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const addListener = vi.spyOn(chapter, "addEventListener");
    const removeListener = vi.spyOn(chapter, "removeEventListener");
    const onKeyDown = vi.fn();
    const onRemoved = vi.fn();
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({ onDocumentRemoved: onRemoved, onKeyDown });

    expect(registry.bind({ document: chapter, window: frame.contentWindow! })).toBe(true);
    expect(registry.bind({ document: chapter, window: frame.contentWindow! })).toBe(false);
    chapter.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(addListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    expect(registry.remove(chapter)).toBe(true);
    expect(registry.remove(chapter)).toBe(false);
    expect(removeListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    expect(onRemoved).toHaveBeenCalledOnce();
  });

  it("uses current callbacks without rebinding the document", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const first = vi.fn();
    const second = vi.fn();
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({ onInteraction: first });
    registry.bind({ document: chapter, window: frame.contentWindow! });

    registry.updateOptions({ onInteraction: second });
    chapter.dispatchEvent(new MouseEvent("mousemove"));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("prunes only disconnected frames and retains a connected sibling", () => {
    const first = mountedFrame();
    const second = mountedFrame();
    const registry = new ReaderContentDocumentRegistry();
    const onRemoved = vi.fn();
    registry.updateOptions({ onDocumentRemoved: onRemoved });
    const firstDocument = first.contentDocument!;
    const secondDocument = second.contentDocument!;
    registry.bind({ document: firstDocument, window: first.contentWindow! });
    registry.bind({ document: secondDocument, window: second.contentWindow! });

    first.remove();
    registry.pruneDisconnected();

    expect(registry.has(firstDocument)).toBe(false);
    expect(registry.has(secondDocument)).toBe(true);
    expect(onRemoved).toHaveBeenCalledOnce();
    expect(onRemoved.mock.calls[0]?.[0]).toBe(firstDocument);
  });

  it("applies theme changes to registered documents without replacing the registry", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const registry = new ReaderContentDocumentRegistry();
    registry.bind({ document: chapter, window: frame.contentWindow! });

    registry.applyTheme(
      null,
      createReaderContentTheme({ ...defaultReaderSettings, fontFamily: "literata" }),
      null,
    );
    const style = chapter.getElementById("archeion-reader-font-faces");
    registry.applyTheme(
      null,
      createReaderContentTheme({ ...defaultReaderSettings, fontFamily: "atkinson" }),
      null,
    );

    expect(chapter.getElementById("archeion-reader-font-faces")).toBe(style);
    expect(style?.textContent).toContain('font-family: "Atkinson Hyperlegible"');
  });
});
