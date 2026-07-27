// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import { defaultReaderSettings } from "../../types/reader";
import { resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { inputModalityRuntime } from "../../app/inputModality";
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
    resetTransientSurfaceOwnershipForTests();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("routes EPUB Escape through the topmost parent transient before reader-local fallbacks", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const lowerDismiss = vi.fn();
    const topDismiss = vi.fn();
    const localEscape = vi.fn(() => true);
    const onContentKeyDown = vi.fn(() => true);
    const onKeyDown = vi.fn();
    registerTransientSurface({
      element: document.body.appendChild(document.createElement("aside")),
      kind: "reader-panel",
      onDismiss: lowerDismiss,
    });
    registerTransientSurface({
      element: document.body.appendChild(document.createElement("div")),
      kind: "popover",
      onDismiss: topDismiss,
    });
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({ onContentKeyDown, onEscape: localEscape, onKeyDown });
    registry.bind({ document: chapter, window: frame.contentWindow! });
    const laterListener = vi.fn();
    chapter.addEventListener("keydown", laterListener, true);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });

    chapter.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(topDismiss).toHaveBeenCalledOnce();
    expect(lowerDismiss).not.toHaveBeenCalled();
    expect(localEscape).not.toHaveBeenCalled();
    expect(onContentKeyDown).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(laterListener).not.toHaveBeenCalled();
  });

  it("uses the same surface order for EPUB and parent-document Escape", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const lowerDismiss = vi.fn();
    const topDismiss = vi.fn();
    let unregisterLower: () => void = () => undefined;
    let unregisterTop: () => void = () => undefined;
    unregisterLower = registerTransientSurface({
      element: document.body.appendChild(document.createElement("aside")),
      kind: "reader-panel",
      onDismiss: (reason) => {
        lowerDismiss(reason);
        unregisterLower();
      },
    });
    unregisterTop = registerTransientSurface({
      element: document.body.appendChild(document.createElement("div")),
      kind: "popover",
      onDismiss: (reason) => {
        topDismiss(reason);
        unregisterTop();
      },
    });
    const registry = new ReaderContentDocumentRegistry();
    registry.bind({ document: chapter, window: frame.contentWindow! });

    chapter.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));

    expect(topDismiss).toHaveBeenCalledWith("escape");
    expect(lowerDismiss).toHaveBeenCalledWith("escape");
  });

  it("retains the reader-local EPUB Escape fallback when no transient claims it", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const onEscape = vi.fn(() => true);
    const onContentKeyDown = vi.fn(() => true);
    const onKeyDown = vi.fn();
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({ onContentKeyDown, onEscape, onKeyDown });
    registry.bind({ document: chapter, window: frame.contentWindow! });
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });

    chapter.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onEscape).toHaveBeenCalledOnce();
    expect(onContentKeyDown).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
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

  it("reports EPUB pointer and owned keyboard intent without styling publisher content", () => {
    const stopInputModality = inputModalityRuntime.start(document);
    try {
      const frame = mountedFrame();
      const chapter = frame.contentDocument!;
      const registry = new ReaderContentDocumentRegistry();
      registry.updateOptions({
        onContentKeyDown: (event) => event.key === "ArrowRight",
      });
      registry.bind({ document: chapter, window: frame.contentWindow! });

      inputModalityRuntime.markKeyboard();
      chapter.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(document.documentElement.dataset.inputModality).toBe("pointer");
      expect(chapter.documentElement.hasAttribute("data-input-modality")).toBe(false);

      chapter.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowRight",
        }),
      );
      expect(document.documentElement.dataset.inputModality).toBe("keyboard");
      expect(chapter.documentElement.hasAttribute("data-input-modality")).toBe(false);

      registry.clear();
    } finally {
      stopInputModality();
    }
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

  it("suppresses EPUB link activation before reader page-turn and highlight interactions", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const link = chapter.createElement("a");
    link.href = "#note";
    chapter.body.append(link);
    const onContentClick = vi.fn(() => true);
    const onInteraction = vi.fn();
    const onPointerDown = vi.fn();
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({
      onContentClick,
      onContentPointerDown: () => true,
      onInteraction,
      onPointerDown,
    });
    registry.bind({
      document: chapter,
      section: { href: "Text/chapter.xhtml" },
      window: frame.contentWindow!,
    });
    const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    link.dispatchEvent(pointerDown);
    link.dispatchEvent(click);

    expect(onContentClick).toHaveBeenCalledWith(
      click,
      expect.objectContaining({ document: chapter, sectionHref: "Text/chapter.xhtml" }),
    );
    expect(click.defaultPrevented).toBe(true);
    expect(onInteraction).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it("routes link pointer and click events from every registered EPUB document", () => {
    const first = mountedFrame();
    const second = mountedFrame();
    const secondDocument = second.contentDocument!;
    const link = secondDocument.createElement("a");
    link.href = "chapter-3.xhtml#section";
    secondDocument.body.append(link);
    const onContentClick = vi.fn(() => true);
    const onContentPointerDown = vi.fn(() => true);
    const onInteraction = vi.fn();
    const onPointerDown = vi.fn();
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({
      onContentClick,
      onContentPointerDown,
      onInteraction,
      onPointerDown,
    });
    registry.bind({
      document: first.contentDocument!,
      section: { href: "Text/chapter-1.xhtml" },
      window: first.contentWindow!,
    });
    registry.bind({
      document: secondDocument,
      section: { href: "Text/chapter-2.xhtml" },
      window: second.contentWindow!,
    });

    const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(pointerDown);
    link.dispatchEvent(click);

    expect(onContentPointerDown).toHaveBeenCalledWith(
      pointerDown,
      expect.objectContaining({
        document: secondDocument,
        sectionHref: "Text/chapter-2.xhtml",
      }),
    );
    expect(onContentClick).toHaveBeenCalledWith(
      click,
      expect.objectContaining({
        document: secondDocument,
        sectionHref: "Text/chapter-2.xhtml",
      }),
    );
    expect(click.defaultPrevented).toBe(true);
    expect(onInteraction).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
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
      createReaderContentTheme(
        { ...defaultReaderSettings, fontFamily: "literata" },
        resolveBuiltInReaderTheme("dark").tokens,
      ),
      null,
    );
    const style = chapter.getElementById("archeion-reader-font-faces");
    registry.applyTheme(
      null,
      createReaderContentTheme(
        { ...defaultReaderSettings, fontFamily: "atkinson" },
        resolveBuiltInReaderTheme("dark").tokens,
      ),
      null,
    );

    expect(chapter.getElementById("archeion-reader-font-faces")).toBe(style);
    expect(style?.textContent).toContain('font-family: "Atkinson Hyperlegible"');
  });
});
