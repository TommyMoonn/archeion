// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import { defaultReaderSettings } from "../../types/reader";
import { resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { focusPresentationRuntime } from "../../app/inputModality";
import { createReaderContentTheme } from "./readerTheme";
import {
  ReaderContentDocumentRegistry,
  ReaderContentDocumentSessionOwner,
} from "./readerContentDocumentRegistry";

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
  it("does not repeat a new mount's current geometry or restyle a retired document", () => {
    const registry = new ReaderContentDocumentRegistry();
    const palette = resolveBuiltInReaderTheme("dark").tokens;
    const layout = {
      mode: "continuous",
      readingWidth: "comfortable",
      stageSize: { width: 1050, height: 750 },
    } as const;
    registry.applyTheme(null, createReaderContentTheme(defaultReaderSettings, palette), null);
    registry.applyLayout(layout, null);
    const first = mountedFrame();
    first.contentDocument!.body.innerHTML = '<img src="plate.svg" alt="Plate">';
    registry.bindRenderedView({ document: first.contentDocument! }, "first.xhtml");
    const retiredQuery = vi.spyOn(first.contentDocument!, "querySelectorAll");
    first.remove();
    registry.applyTheme(
      null,
      createReaderContentTheme({ ...defaultReaderSettings, fontSize: 24 }, palette),
      null,
    );
    const replacement = mountedFrame();
    const doc = replacement.contentDocument!;
    doc.body.innerHTML = '<img src="plate.svg" alt="Plate">';
    const query = vi.spyOn(doc, "querySelectorAll");
    registry.bindRenderedView({ document: doc }, "replacement.xhtml");
    const mountCalls = query.mock.calls.length;
    registry.applyLayout(layout, null);
    expect(query.mock.calls.length).toBe(mountCalls);
    expect(retiredQuery).not.toHaveBeenCalled();
    expect(registry.list()).toEqual([doc]);
    registry.retire();
  });

  it("leaves unthemed fixed-layout content unclassified and prepares a later reflowable theme once", () => {
    const registry = new ReaderContentDocumentRegistry();
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    chapter.body.innerHTML = "<p>Publisher page composition.</p>";
    const queries = vi.spyOn(chapter, "querySelectorAll");
    registry.bindRenderedView({ document: chapter }, "page.xhtml");
    expect(chapter.querySelector("p")?.hasAttribute("data-archeion-running-prose")).toBe(false);
    expect(queries).not.toHaveBeenCalled();
    const theme = createReaderContentTheme(
      defaultReaderSettings,
      resolveBuiltInReaderTheme("dark").tokens,
    );
    registry.applyTheme(null, theme, null);
    registry.applyTheme(null, { ...theme }, null);
    expect(queries.mock.calls.filter(([selector]) => selector === "p")).toHaveLength(1);
    expect(chapter.querySelector("p")?.hasAttribute("data-archeion-running-prose")).toBe(true);
    registry.retire();
  });

  it("styles a mounted document once and invalidates only changed appearance or geometry", () => {
    const registry = new ReaderContentDocumentRegistry();
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    chapter.body.innerHTML = '<p>Running prose.</p><img src="plate.svg" alt="Plate">';
    const queries = vi.spyOn(chapter, "querySelectorAll");
    const computed = vi.spyOn(frame.contentWindow!, "getComputedStyle");
    const theme = createReaderContentTheme(
      defaultReaderSettings,
      resolveBuiltInReaderTheme("dark").tokens,
    );
    const layout = {
      mode: "continuous",
      readingWidth: "comfortable",
      stageSize: { width: 1050, height: 750 },
    } as const;
    registry.applyTheme(null, theme, null);
    registry.applyLayout(layout, null);
    registry.bindRenderedView({ document: chapter }, "chapter.xhtml");
    const mountedQueries = queries.mock.calls.length;
    const mountedComputed = computed.mock.calls.length;
    expect(mountedComputed).toBeGreaterThan(0);
    for (let index = 0; index < 20; index++) {
      registry.bindRenderedView({ document: chapter }, "chapter.xhtml");
      registry.applyTheme(null, { ...theme, rules: structuredClone(theme.rules) }, document.body);
      registry.applyLayout({ ...layout, stageSize: { ...layout.stageSize } }, document.body);
      registry.applyLayoutStageSize({ ...layout.stageSize }, document.body);
    }
    expect(queries.mock.calls.length).toBe(mountedQueries);
    expect(computed.mock.calls.length).toBe(mountedComputed);

    registry.applyTheme(
      null,
      createReaderContentTheme(defaultReaderSettings, resolveBuiltInReaderTheme("light").tokens),
      null,
    );
    registry.applyLayout(layout, null);
    expect(computed.mock.calls.length).toBe(mountedComputed);
    const proseScans = () => queries.mock.calls.filter(([selector]) => selector === "p").length;
    expect(proseScans()).toBe(1);
    registry.applyTheme(
      null,
      createReaderContentTheme(
        { ...defaultReaderSettings, fontSize: 24 },
        resolveBuiltInReaderTheme("light").tokens,
      ),
      null,
    );
    registry.applyLayout(layout, null);
    expect(computed.mock.calls.length).toBeGreaterThan(mountedComputed);
    const changedComputed = computed.mock.calls.length;
    registry.applyLayoutStageSize({ width: 900, height: 700 }, null);
    expect(computed.mock.calls.length).toBeGreaterThan(changedComputed);
    expect(proseScans()).toBe(1);
    registry.retire();
  });
  it("does not prepare a disconnected document through a late rendered notification before pruning", () => {
    const registry = new ReaderContentDocumentRegistry();
    const ready = vi.fn();
    const removed = vi.fn();
    registry.updateOptions({ onDocumentReady: ready, onDocumentRemoved: removed });
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    registry.bind({ document: chapter });
    frame.remove();
    registry.bindRenderedView({ document: chapter }, "chapter.xhtml");
    expect(ready).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledExactlyOnceWith(chapter);
    expect(registry.list()).toEqual([]);
  });
  it("prepares only a newly identified living document and applies current styles on remount", () => {
    const registry = new ReaderContentDocumentRegistry();
    const ready = vi.fn();
    registry.updateOptions({ onDocumentReady: ready });
    const theme = createReaderContentTheme(
      defaultReaderSettings,
      resolveBuiltInReaderTheme("dark").tokens,
    );
    registry.applyTheme(null, theme, null);
    registry.applyLayout(
      { mode: "continuous", readingWidth: "comfortable", stageSize: { width: 1000, height: 750 } },
      null,
    );
    const first = mountedFrame();
    const doc = first.contentDocument!;
    registry.bind({ document: doc });
    registry.bindRenderedView({ contents: { document: doc } }, "Text/chapter.xhtml");
    registry.bindRenderedView({ contents: { document: doc } }, "Text/chapter.xhtml");
    registry.bindMounted(document.body);
    expect(ready).toHaveBeenCalledExactlyOnceWith({
      document: doc,
      sectionHref: "Text/chapter.xhtml",
    });
    first.remove();
    registry.pruneDisconnected();
    const remounted = mountedFrame();
    registry.bindRenderedView({ document: remounted.contentDocument! }, "Text/chapter.xhtml");
    expect(ready).toHaveBeenCalledTimes(2);
    expect(remounted.contentDocument!.querySelectorAll("style").length).toBeGreaterThan(0);
    expect(registry.list()).toEqual([remounted.contentDocument]);
    registry.clear();
  });
  it("does not resurrect a retired generation through late content or rendered hooks", () => {
    const owner = new ReaderContentDocumentSessionOwner();
    const first = owner.activate();
    const oldFrame = mountedFrame();
    const oldDocument = oldFrame.contentDocument!;
    const removed = vi.fn();
    owner.access.updateOptions({ onDocumentRemoved: removed });
    first.bind({ document: oldDocument });
    const second = owner.activate();
    const currentFrame = mountedFrame();
    second.bind({ document: currentFrame.contentDocument! });

    expect(first.bind({ document: oldDocument })).toBe(false);
    expect(first.bindRenderedView({ document: mountedFrame().contentDocument! })).toBe(false);
    first.bindMounted(document.body);
    owner.retire(first);
    expect(first.list()).toEqual([]);
    expect(owner.access.list()).toEqual([currentFrame.contentDocument]);
    expect(removed).toHaveBeenCalledOnce();
    owner.retire(second);
    expect(owner.access.list()).toEqual([]);
  });

  it("releases every listener once over 42 recreations and rejects captured retired callbacks", () => {
    const registry = new ReaderContentDocumentRegistry();
    const onContentClick = vi.fn(() => false);
    const onKeyDown = vi.fn();
    const onRemoved = vi.fn();
    registry.updateOptions({ onContentClick, onKeyDown, onDocumentRemoved: onRemoved });
    for (let index = 0; index < 42; index += 1) {
      const frame = mountedFrame();
      const chapter = frame.contentDocument!;
      const add = vi.spyOn(chapter, "addEventListener");
      const remove = vi.spyOn(chapter, "removeEventListener");
      const addWindow = vi.spyOn(frame.contentWindow!, "addEventListener");
      const removeWindow = vi.spyOn(frame.contentWindow!, "removeEventListener");
      registry.bind({ document: chapter });
      registry.bindRenderedView({ document: chapter }, "Text/same-chapter.xhtml");
      chapter.dispatchEvent(new MouseEvent("click"));
      chapter.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
      const callbacks = [...add.mock.calls, ...addWindow.mock.calls];
      frame.remove();
      registry.pruneDisconnected();
      registry.remove(chapter);
      for (const call of add.mock.calls) expect(remove.mock.calls).toContainEqual(call);
      expect(removeWindow.mock.calls).toEqual(addWindow.mock.calls);
      // A queued callback can outlive removeEventListener. It must be inert too.
      for (const [type, callback] of callbacks) {
        const event = type === "keydown" ? new KeyboardEvent(type) : new Event(type);
        if (typeof callback === "function") callback.call(chapter, event);
      }
      expect(registry.bind({ document: chapter })).toBe(false);
      expect(registry.list()).toEqual([]);
      expect(onContentClick).toHaveBeenCalledTimes(index + 1);
      expect(onKeyDown).toHaveBeenCalledTimes(index + 1);
      expect(onRemoved).toHaveBeenCalledTimes(index + 1);
    }
  });

  it("leaves native Continuous input unregistered while retaining content interactions", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const addDocument = vi.spyOn(chapter, "addEventListener");
    const addWindow = vi.spyOn(frame.contentWindow!, "addEventListener");
    const onKeyDown = vi.fn();
    const onContentClick = vi.fn(() => false);
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({ onKeyDown, onContentClick });
    registry.bind({ document: chapter, window: frame.contentWindow! });
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 95 });
    chapter.body.dispatchEvent(wheel);
    chapter.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }));
    chapter.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(wheel.defaultPrevented).toBe(false);
    expect(addDocument.mock.calls.filter(([type]) => type === "wheel")).toHaveLength(0);
    expect(addWindow.mock.calls.filter(([type]) => type === "wheel")).toHaveLength(0);
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onContentClick).toHaveBeenCalledOnce();
    registry.clear();
  });

  it("installs one Paged wheel owner and releases it on capability change and teardown", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const first = vi.fn();
    const replacement = vi.fn();
    const registry = new ReaderContentDocumentRegistry();
    registry.bind({ document: chapter, window: frame.contentWindow! });
    registry.updateOptions({ onWheel: first });
    chapter.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(first).toHaveBeenCalledOnce();
    registry.updateOptions({ onWheel: replacement });
    chapter.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(first).toHaveBeenCalledOnce();
    expect(replacement).toHaveBeenCalledOnce();
    registry.updateOptions({});
    chapter.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(replacement).toHaveBeenCalledOnce();
    registry.updateOptions({ onWheel: replacement });
    registry.remove(chapter);
    chapter.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(replacement).toHaveBeenCalledOnce();
  });

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

  it("keeps prevented focus-stationary EPUB navigation in pointer presentation", () => {
    const stopFocusPresentation = focusPresentationRuntime.start(document);
    try {
      const frame = mountedFrame();
      const chapter = frame.contentDocument!;
      const registry = new ReaderContentDocumentRegistry();
      registry.updateOptions({
        onContentKeyDown: (event) => event.key === "ArrowRight",
      });
      registry.bind({ document: chapter, window: frame.contentWindow! });

      focusPresentationRuntime.markKeyboardNavigation();
      chapter.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(document.documentElement.dataset.focusPresentation).toBe("pointer");
      expect(chapter.documentElement.hasAttribute("data-focus-presentation")).toBe(false);

      chapter.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowRight",
        }),
      );
      expect(document.documentElement.dataset.focusPresentation).toBe("pointer");
      expect(chapter.documentElement.hasAttribute("data-focus-presentation")).toBe(false);

      registry.clear();
    } finally {
      stopFocusPresentation();
    }
  });

  it("suppresses EPUB link activation before reader page-turn and highlight interactions", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const link = chapter.createElement("a");
    link.href = "#note";
    chapter.body.append(link);
    const onContentClick = vi.fn(() => true);
    const onPointerDown = vi.fn();
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({
      onContentClick,
      onContentPointerDown: () => true,
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
    const onPointerDown = vi.fn();
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({
      onContentClick,
      onContentPointerDown,
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
        { ...defaultReaderSettings, fontFamily: { kind: "builtin", id: "literata" } },
        resolveBuiltInReaderTheme("dark").tokens,
      ),
      null,
    );
    const style = chapter.getElementById("archeion-reader-font-faces");
    registry.applyTheme(
      null,
      createReaderContentTheme(
        { ...defaultReaderSettings, fontFamily: { kind: "builtin", id: "atkinson" } },
        resolveBuiltInReaderTheme("dark").tokens,
      ),
      null,
    );

    expect(chapter.getElementById("archeion-reader-font-faces")).toBe(style);
    expect(style?.textContent).toContain('font-family: "Atkinson Hyperlegible"');
  });

  it("switches bundled faces to a system family in the same registered document without touching chrome", () => {
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    document.documentElement.style.setProperty("--font-ui", "Inter, sans-serif");
    const chrome = document.body.appendChild(document.createElement("button"));
    chrome.style.fontFamily = "var(--font-ui)";
    const registry = new ReaderContentDocumentRegistry();
    registry.bind({ document: chapter, window: frame.contentWindow! });
    const tokens = resolveBuiltInReaderTheme("dark").tokens;
    registry.applyTheme(
      null,
      createReaderContentTheme(
        { ...defaultReaderSettings, fontFamily: { kind: "builtin", id: "literata" } },
        tokens,
      ),
      null,
    );
    expect(chapter.getElementById("archeion-reader-font-faces")).not.toBeNull();
    const register = vi.fn();
    const select = vi.fn();
    const rendition = { themes: { register, select } } as unknown as import("epubjs").Rendition;
    const theme = createReaderContentTheme(
      { ...defaultReaderSettings, fontFamily: { kind: "system", family: "Arial" } },
      tokens,
      ["Arial"],
    );
    registry.applyTheme(rendition, theme, null);
    expect(register).toHaveBeenCalledWith("archeion-reader", theme.rules);
    expect(select).toHaveBeenCalledWith("archeion-reader");
    expect(chapter.getElementById("archeion-reader-font-faces")).toBeNull();
    expect(registry.has(chapter)).toBe(true);
    expect(frame.contentDocument).toBe(chapter);
    expect(chrome.isConnected).toBe(true);
    expect(chrome.style.fontFamily).toBe("var(--font-ui)");
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe("Inter, sans-serif");
    document.documentElement.style.removeProperty("--font-ui");
  });

  it("applies the current reflowable layout when a later iframe document mounts", () => {
    const registry = new ReaderContentDocumentRegistry();
    registry.applyLayout({ mode: "paged", readingWidth: "narrow" }, null);
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    chapter.body.style.width = "2200px";
    chapter.body.style.columnWidth = "700px";
    const renditionGeometry = chapter.body.getAttribute("style");

    registry.bind({ document: chapter, window: frame.contentWindow! });

    expect(chapter.body.getAttribute("style")).toBe(renditionGeometry);
    const style = chapter.getElementById("archeion-reader-reflowable-layout");
    expect(style?.dataset.readerMode).toBe("paged");
    expect(style?.textContent).toContain("max-inline-size: 58ch !important");
  });

  it("updates and retains continuous Reader-stage metrics for later mounted documents", () => {
    const registry = new ReaderContentDocumentRegistry();
    registry.applyLayout(
      {
        mode: "continuous",
        readingWidth: "comfortable",
        stageSize: { height: 720, width: 960 },
      },
      null,
    );
    registry.applyLayoutStageSize({ height: 760, width: 1180 }, null);

    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    registry.bind({ document: chapter, window: frame.contentWindow! });

    const layout = chapter.getElementById("archeion-reader-reflowable-layout");
    expect(layout?.dataset.readerMode).toBe("continuous");
    expect(layout?.dataset.readerWidth).toBe("comfortable");
    expect(layout?.textContent).toContain("--archeion-reader-stage-width: 1180px");
    expect(layout?.textContent).toContain("--archeion-reader-stage-height: 760px");
  });

  it("applies current continuous media bounds to later documents and updates them on stage resize", () => {
    const registry = new ReaderContentDocumentRegistry();
    registry.applyLayout(
      {
        mode: "continuous",
        readingWidth: "comfortable",
        stageSize: { height: 720, width: 960 },
      },
      null,
    );
    registry.applyLayoutStageSize({ height: 760, width: 1180 }, null);

    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    chapter.head.innerHTML = `<style>
      .plate { width: 1600px !important; max-width: none !important; max-height: none !important; }
    </style>`;
    chapter.body.innerHTML = `<img id="plate" class="plate" src="plate.jpg" alt="Plate">`;
    registry.bind({ document: chapter, window: frame.contentWindow! });

    const plate = chapter.getElementById("plate")!;
    expect(plate.hasAttribute("data-archeion-media-fit")).toBe(true);
    expect(frame.contentWindow!.getComputedStyle(plate).maxBlockSize).toBe("608px");

    registry.applyLayoutStageSize({ height: 640, width: 1000 }, null);

    expect(frame.contentWindow!.getComputedStyle(plate).maxBlockSize).toBe("512px");
    expect(plate.getAttribute("style")).toBeNull();
  });

  it("keeps a media-only first continuous document finite while later documents mount normally", () => {
    const registry = new ReaderContentDocumentRegistry();
    registry.applyLayout(
      {
        mode: "continuous",
        readingWidth: "full",
        stageSize: { height: 760, width: 1180 },
      },
      null,
    );

    const coverFrame = mountedFrame();
    const coverChapter = coverFrame.contentDocument!;
    coverChapter.body.innerHTML = `
      <div id="cover-flow" style="height: 100vh; margin: 0; padding: 0;">
        <svg id="cover" height="100%" viewBox="0 0 2867 4096" width="100%">
          <image width="2867" height="4096" href="cover.jpg" />
        </svg>
      </div>
    `;
    registry.bind({ document: coverChapter, window: coverFrame.contentWindow! });

    const flow = coverChapter.getElementById("cover-flow")!;
    expect(flow.hasAttribute("data-archeion-media-force-flow-block-fit")).toBe(true);
    expect(coverFrame.contentWindow!.getComputedStyle(flow).maxBlockSize).toBe("608px");

    const textFrame = mountedFrame();
    const textChapter = textFrame.contentDocument!;
    textChapter.body.innerHTML = `<main><p>Following chapter prose.</p></main>`;
    registry.bind({ document: textChapter, window: textFrame.contentWindow! });

    expect(registry.list()).toEqual([coverChapter, textChapter]);
    expect(
      textChapter.getElementById("archeion-reader-reflowable-layout")?.dataset.readerMode,
    ).toBe("continuous");
  });

  it("applies the current content theme when a later iframe document mounts", () => {
    const registry = new ReaderContentDocumentRegistry();
    registry.applyTheme(
      null,
      createReaderContentTheme(
        { ...defaultReaderSettings, fontFamily: { kind: "builtin", id: "literata" } },
        resolveBuiltInReaderTheme("dark").tokens,
      ),
      null,
    );
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    chapter.body.innerHTML = `<main>
      <p id="ordinary">Ordinary prose</p>
      <blockquote><p id="quote">Quoted prose</p></blockquote>
    </main>`;

    registry.bind({ document: chapter, window: frame.contentWindow! });

    expect(chapter.getElementById("archeion-reader-font-faces")?.textContent).toContain(
      'font-family: "Literata"',
    );
    expect(chapter.getElementById("ordinary")?.hasAttribute("data-archeion-running-prose")).toBe(
      true,
    );
    expect(chapter.getElementById("quote")?.hasAttribute("data-archeion-running-prose")).toBe(
      false,
    );
  });
});
