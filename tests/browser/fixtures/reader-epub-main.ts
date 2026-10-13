import ePub, { type Book, type Contents, type Rendition } from "epubjs";
import { buildReaderFixture, readerFixtures } from "../../fixtures/reader/readerFixtures";
import { resolveReaderPublicationLayoutCapability } from "../../../src/features/reader/readerSession";
import { ReaderContentDocumentRegistry } from "../../../src/features/reader/readerContentDocumentRegistry";
import { stabilizeContinuousRendition } from "../../../src/features/reader/readerContinuousScroll";
import { ReaderContinuousViewManager } from "../../../src/features/reader/ReaderContinuousViewManager";
import type { ReaderFixtureId } from "../../fixtures/reader/readerFixtures";
import { probeReaderPrepend } from "./reader-prepend-probe";
import {
  observeReaderRuntime,
  type RuntimeSnapshot,
  type RuntimeEvent,
} from "./reader-runtime-observer";

export type RuntimeOptions = {
  fixture: ReaderFixtureId;
  mode?: "paged" | "continuous";
  profile?: "stock" | "archeion";
  target?: number | string;
  width?: number;
  height?: number;
  scrollbar?: "visible";
  /** Test-only anchoring A/B, applied before initial display. */
  anchoring?: "auto" | "none";
  probePrepend?: boolean;
  /** Synthetic short/long chapter geometry for boundary traversal. */
  alternatingHeights?: boolean;
  /** Test-only reproduction of the removed synchronous pixel-wheel path. */
  legacyWheelForwarding?: boolean;
};

declare global {
  interface Window {
    readerFixture: {
      ready: boolean;
      error: string | null;
      managerState: () => { ignore: boolean };
      residency: () => {
        registeredDocuments: number;
        observerDocuments: number;
        observerViews: number;
      };
      resize: (width: number, height: number) => void;
      layout: "fixed-layout" | "reflowable";
      metadataLayout: string;
      spineCount: number;
      mode: "paged" | "continuous";
      open: (options: RuntimeOptions) => Promise<void>;
      switchMode: (mode: "paged" | "continuous") => Promise<void>;
      display: (target: number | string) => Promise<void>;
      cfi: (id: string, textRange?: boolean) => string;
      textAtCfi: (cfi: string) => Promise<string>;
      highlight: (cfi: string) => void;
      turn: (direction: "next" | "prev") => Promise<void>;
      snapshot: () => RuntimeSnapshot;
      events: () => RuntimeEvent[];
      metrics: ReturnType<typeof observeReaderRuntime>["metrics"];
      clearEvents: () => void;
      dispose: () => void;
      showWheelOverlay: (
        kind: "search" | "annotations" | "footnote" | "illustration" | "illustration-loading",
      ) => Promise<void>;
      closeWheelOverlay: () => void;
      changeImageSize: (height?: number) => Promise<void>;
      prependProbe: () => ReturnType<typeof probeReaderPrepend>;
    };
  }
}

const params = new URLSearchParams(location.search);
const fixture = readerFixtures.find((candidate) => candidate.id === params.get("fixture"));
if (!fixture) throw new Error("Select a known synthetic EPUB fixture");
const stage = document.getElementById("publication")!;
const status = document.getElementById("status")!;
let generation = 0;
let releaseWheelOverlay: (() => void) | undefined;
let active: {
  documents: ReaderContentDocumentRegistry;
  book: Book;
  rendition: Rendition;
  observer: ReturnType<typeof observeReaderRuntime>;
  options: RuntimeOptions;
  release: () => void;
  prependProbe?: ReturnType<typeof probeReaderPrepend>;
} | null = null;
function current() {
  if (!active) throw new Error("Open a fixture first");
  return active;
}
function display(rendition: Rendition, target: string | number) {
  return typeof target === "string" ? rendition.display(target) : rendition.display(target);
}
function dispose() {
  releaseWheelOverlay?.();
  releaseWheelOverlay = undefined;
  generation += 1;
  window.readerFixture.ready = false;
  window.readerFixture.error = null;
  active?.release();
  active = null;
}
async function open(options: RuntimeOptions) {
  dispose();
  const token = generation;
  const selected = readerFixtures.find((candidate) => candidate.id === options.fixture);
  if (!selected) throw new Error("Select a known synthetic EPUB fixture");
  const bytes = await buildReaderFixture(selected.id);
  if (token !== generation) return;
  const documents = new ReaderContentDocumentRegistry();
  const book = ePub(bytes.buffer);
  let observer: ReturnType<typeof observeReaderRuntime> | undefined;
  let removeContentHook: (() => void) | undefined;
  let continuousPosition: ReturnType<typeof stabilizeContinuousRendition> | undefined;
  let prependProbe: ReturnType<typeof probeReaderPrepend> | undefined;
  let releaseAnchoring: (() => void) | undefined;
  let released = false;
  let retained = false;
  // The attempt owns cleanup before any await, including partial renderTo/start failures.
  // Book.destroy owns its rendition, even when renderTo throws before returning it.
  const release = () => {
    if (released) return;
    released = true;
    observer?.dispose();
    continuousPosition?.dispose();
    releaseAnchoring?.();
    prependProbe?.dispose();
    removeContentHook?.();
    documents.clear();
    book.destroy();
  };
  try {
    await book.ready;
    if (token !== generation) return;
    const metadata = await book.loaded.metadata;
    if (token !== generation) return;
    const layout = resolveReaderPublicationLayoutCapability(metadata.layout);
    const mode = options.mode === "continuous" && layout === "reflowable" ? "continuous" : "paged";
    const width = options.width ?? 1050;
    const height = options.height ?? 750;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.toggleAttribute("data-visible-scrollbar", options.scrollbar === "visible");
    const rendition = book.renderTo(stage, {
      width,
      height,
      spread: "none",
      manager:
        mode === "continuous"
          ? options.profile === "archeion"
            ? ReaderContinuousViewManager
            : "continuous"
          : "default",
      flow: mode === "continuous" ? "scrolled-continuous" : "paginated",
      allowScriptedContent: false,
    });
    if (options.alternatingHeights) {
      rendition.hooks.content.register((contents: Contents) => {
        const doc = contents.document;
        if (!doc.title.startsWith("section-")) return;
        const style = doc.createElement("style");
        const lineHeight = Number(doc.title.slice(8)) % 2 === 0 ? 100 : 15;
        // Size actual passage lines: body min-height is outside epub.js's child
        // measurement, and empty heading padding is not a visible text anchor.
        style.textContent = `body { font: 12px/1 serif; } h1 { margin: 0; } p { line-height: ${lineHeight}px; margin-bottom: 0; }`;
        doc.head.appendChild(style);
      });
    }
    if (options.profile === "archeion") {
      if (layout === "reflowable")
        documents.applyLayout(
          {
            mode,
            readingWidth: "comfortable",
            stageSize: { width, height },
          },
          stage,
        );
      documents.updateOptions({
        onWheel:
          mode === "continuous" && options.legacyWheelForwarding
            ? (event) => {
                const scroller = stage.querySelector<HTMLElement>(".epub-container");
                if (!scroller || event.defaultPrevented || event.deltaMode !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                scroller.scrollTop += event.deltaY;
              }
            : undefined,
      });
      const bindContents = (contents: Contents) => documents.bind(contents);
      const pruneDocuments = () => documents.pruneDisconnected();
      rendition.hooks.content.register(bindContents);
      rendition.on("removed", pruneDocuments);
      removeContentHook = () => {
        rendition.hooks.content.deregister(bindContents);
        rendition.off("removed", pruneDocuments);
      };
    }
    await rendition.started;
    if (token !== generation) return;
    if (options.profile === "archeion" && mode === "continuous")
      continuousPosition = stabilizeContinuousRendition(
        rendition,
        () => token === generation && !released,
        () => {
          if (token !== generation || released) return;
          window.readerFixture.error = "open-failed";
          window.readerFixture.ready = false;
          status.textContent = "Synthetic chapter unavailable. Reopen the fixture to retry.";
          release();
        },
      );
    if (mode === "continuous" && options.anchoring) {
      const anchoring = options.anchoring;
      const applyAnchoring = () => {
        const scroller = stage.querySelector<HTMLElement>(".epub-container");
        if (token === generation && !released && scroller)
          scroller.style.overflowAnchor = anchoring;
      };
      rendition.on("attached", applyAnchoring);
      releaseAnchoring = () => rendition.off("attached", applyAnchoring);
    }
    observer = observeReaderRuntime(stage, selected, rendition);
    if (mode === "continuous" && options.probePrepend)
      prependProbe = probeReaderPrepend(rendition, observer.snapshot);
    active = { book, rendition, observer, options, release, prependProbe, documents };
    await display(rendition, options.target ?? 0);
    if (token !== generation || released) return;
    const scroller = stage.querySelector<HTMLElement>(".epub-container");
    if (scroller) scroller.tabIndex = 0;
    window.readerFixture.mode = mode;
    window.readerFixture.layout = layout;
    window.readerFixture.metadataLayout = metadata.layout;
    window.readerFixture.spineCount = selected.sections.length;
    window.readerFixture.ready = true;
    status.textContent = `Loaded synthetic ${selected.id}`;
    retained = true;
  } catch (error) {
    if (token === generation) throw error;
  } finally {
    if (!retained) {
      // Never clear a newer session when an older attempt settles late.
      if (active?.release === release) active = null;
      release();
    }
  }
}
window.readerFixture = {
  ready: false,
  error: null,
  managerState: () => {
    const manager = (current().rendition as Rendition & { manager: { ignore: boolean } }).manager;
    return { ignore: manager.ignore };
  },
  residency: () => ({
    registeredDocuments: current().documents.list().length,
    ...current().observer.metrics().listeners,
  }),
  resize: (width, height) => {
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    current().rendition.resize(width, height);
  },
  layout: "reflowable",
  metadataLayout: "",
  spineCount: 0,
  mode: "paged",
  open,
  switchMode: (mode) => {
    const session = current();
    const cfi = session.rendition.location?.start.cfi;
    return open({ ...session.options, mode, target: cfi ?? session.options.target });
  },
  display: (target) => display(current().rendition, target),
  turn: (direction) => current().rendition[direction](),
  cfi: (id, textRange = false) => {
    const session = current();
    for (const frame of stage.querySelectorAll("iframe")) {
      const element = frame.contentDocument?.getElementById(id);
      if (!element) continue;
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(textRange ? (element.firstChild ?? element) : element);
      const contents = session.rendition.getContents();
      // epub.js declarations say a single Contents, but runtime returns an array.
      const mounted = Array.isArray(contents) ? (contents as Contents[]) : [contents];
      const content = mounted.find((candidate) => candidate.document === element.ownerDocument);
      if (content) return content.cfiFromRange(range);
    }
    throw new Error("CFI anchor must be in a mounted synthetic section");
  },
  textAtCfi: async (cfi) => (await current().book.getRange(cfi)).toString(),
  highlight: (cfi) => {
    current().rendition.annotations.highlight(cfi, { note: "Synthetic fixture note" });
  },
  snapshot: () => current().observer.snapshot(),
  events: () => current().observer.events(),
  metrics: () => current().observer.metrics(),
  clearEvents: () => current().observer.clear(),
  dispose,
  showWheelOverlay: async (kind) => {
    const token = generation;
    const { mountWheelOverlay } = await import("./reader-wheel-overlays");
    if (token !== generation) return;
    releaseWheelOverlay?.();
    releaseWheelOverlay = mountWheelOverlay(kind);
  },
  closeWheelOverlay: () => {
    releaseWheelOverlay?.();
    releaseWheelOverlay = undefined;
  },
  prependProbe: () => {
    const probe = current().prependProbe;
    if (!probe) throw new Error("Open with probePrepend to run a controlled experiment");
    return probe;
  },
  async changeImageSize(height) {
    const selected = readerFixtures.find(
      (candidate) => candidate.id === current().options.fixture,
    )!;
    const change = selected.sizeChanges[0];
    if (!change) throw new Error("This fixture has no delayed image");
    const element = [...stage.querySelectorAll("iframe")]
      .map((frame) => frame.contentDocument?.getElementById(change.elementId))
      .find((candidate) => candidate);
    if (!element || element.tagName.toLowerCase() !== "img")
      throw new Error("Display the image section before changing its height");
    // A controlled post-display style change models delayed sizing. No timer, script in
    // the publication, network request, or manual private manager check is involved.
    element.style.setProperty("height", `${height ?? change.settledHeight}px`, "important");
    element.style.setProperty("max-height", "none", "important");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  },
};
await open({
  fixture: fixture.id,
  mode: params.get("flow") === "continuous" ? "continuous" : "paged",
  profile: params.get("profile") === "archeion" ? "archeion" : "stock",
  target: Number(params.get("section") ?? 0),
});
window.addEventListener("pagehide", dispose, { once: true });
