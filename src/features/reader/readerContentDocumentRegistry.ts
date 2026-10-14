import type { Rendition } from "epubjs";

import { focusPresentationRuntime } from "../../app/inputModality";
import { claimTransientSurfaceEscape } from "../../utils/transientSurfaceOwnership";
import {
  applyReaderContentTheme,
  prepareReaderRunningProse,
  readerContentThemeGeometryKey,
  type ReaderContentTheme,
} from "./readerTheme";
import type { ReaderStageSize } from "./readerStageGeometry";
import { applyReaderReflowableLayout, type ReaderReflowableLayout } from "./readerReflowableLayout";
import { applyReaderReflowableMedia, observeReaderMediaReadiness } from "./readerReflowableMedia";

export type EpubContent = {
  document?: Document;
  section?: { href?: string };
  window?: Window;
};

export type RenderedView = {
  contents?: {
    document?: Document;
    window?: Window;
  };
  document?: Document;
  iframe?: HTMLIFrameElement;
};

export type ReaderContentDocumentContext = Readonly<{
  document: Document;
  sectionHref?: string;
}>;

export type ReaderContentDocumentRegistryOptions = {
  onContentClick?: (event: MouseEvent, context: ReaderContentDocumentContext) => boolean;
  onContentKeyDown?: (event: KeyboardEvent, context: ReaderContentDocumentContext) => boolean;
  onContentPointerDown?: (event: PointerEvent, context: ReaderContentDocumentContext) => boolean;
  onDocumentRemoved?: (document: Document) => void;
  onDocumentReady?: (context: ReaderContentDocumentContext) => void;
  onEscape?: () => boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
  onPointerDown?: () => void;
  onSelectionCollapsed?: (document: Document) => void;
  onWheel?: (event: WheelEvent) => void;
};

export type ReaderContentDocumentAccess = Readonly<{
  clearSelection: (document?: Document) => void;
  contextFor: (document: Document) => ReaderContentDocumentContext | null;
  has: (document: Document) => boolean;
  list: () => readonly Document[];
  pruneDisconnected: () => void;
  updateOptions: (options: ReaderContentDocumentRegistryOptions) => void;
}>;

type RegisteredDocument = {
  cleanup: () => void;
  updateWheel: () => void;
  sectionHref?: string;
  frame: Element | null;
  layoutKey: string | null;
  prosePrepared: boolean;
};

function documentFromRenderedView(view: unknown): Document | null {
  const renderedView = view as RenderedView | null;
  return (
    renderedView?.document ??
    renderedView?.contents?.document ??
    renderedView?.iframe?.contentDocument ??
    null
  );
}

function contentWindow(document: Document, candidate?: Window): Window | null {
  return candidate ?? document.defaultView ?? null;
}

function frameOwnsDocument(frame: Element | null, document: Document): boolean {
  return Boolean(frame?.isConnected && (frame as HTMLIFrameElement).contentDocument === document);
}

export class ReaderContentDocumentRegistry {
  private documents = new Map<Document, RegisteredDocument>();
  private options: ReaderContentDocumentRegistryOptions = {};
  private theme: ReaderContentTheme | null = null;
  private layout: ReaderReflowableLayout | null = null;
  private themeKey: string | null = null;
  private themedRendition: Rendition | null = null;
  private layoutKey: string | null = null;
  private retired = false;
  private retiredDocuments = new WeakSet<Document>();

  updateOptions(options: ReaderContentDocumentRegistryOptions): void {
    if (this.retired) return;
    this.options = options;
    for (const registered of this.documents.values()) registered.updateWheel();
  }

  bind(content: EpubContent | null): boolean {
    const document = content?.document ?? null;
    if (!document || this.retired || this.retiredDocuments.has(document)) return false;
    const existing = this.documents.get(document);
    if (existing) {
      if (!this.has(document)) {
        this.remove(document);
        return false;
      }
      if (content?.section?.href && existing.sectionHref !== content.section.href) {
        existing.sectionHref = content.section.href;
        this.options.onDocumentReady?.({ document, sectionHref: existing.sectionHref });
      }
      return false;
    }

    const window = contentWindow(document, content?.window);
    const frame = window?.frameElement ?? document.defaultView?.frameElement ?? null;
    if (frame && !frameOwnsDocument(frame, document)) return false;
    if (this.theme) applyReaderContentTheme(null, this.theme, [document]);
    if (this.layout) applyReaderReflowableLayout(document, this.layout);
    const ownsDocument = () => this.has(document);
    const wheelOptions: AddEventListenerOptions = { capture: true, passive: false };
    const keyOptions: AddEventListenerOptions = { capture: true };

    const onContentKeyDown = (event: KeyboardEvent) => {
      if (!ownsDocument()) return;
      focusPresentationRuntime.reportKeyDown(event);
      if (event.key === "Escape") {
        if (claimTransientSurfaceEscape(event) || event.defaultPrevented) return;
        if (this.options.onEscape?.()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (this.options.onContentKeyDown?.(event, context())) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.options.onKeyDown?.(event);
    };
    const context = (): ReaderContentDocumentContext => ({
      document,
      sectionHref: this.documents.get(document)?.sectionHref,
    });
    const onContentClick = (event: MouseEvent) => {
      if (!ownsDocument()) return;
      if (this.options.onContentClick?.(event, context())) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    };
    const onContentPointerDown = (event: PointerEvent) => {
      if (!ownsDocument()) return;
      focusPresentationRuntime.markPointer();
      if (this.options.onContentPointerDown?.(event, context())) return;
      this.options.onPointerDown?.();
    };
    const onContentTeardown = () => {
      if (this.documents.has(document)) this.remove(document);
    };
    const onSelectionChange = () => {
      if (ownsDocument() && document.getSelection()?.isCollapsed) {
        this.options.onSelectionCollapsed?.(document);
      }
    };
    const onContentWheel: EventListener = (event) => {
      if (ownsDocument()) this.options.onWheel?.(event as WheelEvent);
    };
    let wheelRegistered = false;
    const updateWheel = () => {
      const required = Boolean(this.options.onWheel);
      if (required === wheelRegistered) return;
      // Continuous uses native cross-frame chaining. Paged owns one cancellable
      // document listener, so window/document capture cannot consume a delta twice.
      if (required) document.addEventListener("wheel", onContentWheel, wheelOptions);
      else document.removeEventListener("wheel", onContentWheel, wheelOptions);
      wheelRegistered = required;
    };
    updateWheel();
    document.addEventListener("keydown", onContentKeyDown, keyOptions);
    document.addEventListener("click", onContentClick, true);
    document.addEventListener("pointerdown", onContentPointerDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    window?.addEventListener("pagehide", onContentTeardown);
    const releaseMediaReadiness = this.layout
      ? observeReaderMediaReadiness(document, () => {
          if (ownsDocument() && this.layout) applyReaderReflowableMedia(document, this.layout);
        })
      : () => undefined;

    const cleanup = () => {
      releaseMediaReadiness();
      if (wheelRegistered) document.removeEventListener("wheel", onContentWheel, wheelOptions);
      document.removeEventListener("keydown", onContentKeyDown, keyOptions);
      document.removeEventListener("click", onContentClick, true);
      document.removeEventListener("pointerdown", onContentPointerDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      window?.removeEventListener("pagehide", onContentTeardown);
    };

    this.documents.set(document, {
      cleanup,
      updateWheel,
      sectionHref: content?.section?.href,
      frame,
      layoutKey: this.layout ? this.keyForLayout(this.layout) : null,
      prosePrepared: Boolean(this.theme),
    });
    if (content?.section?.href) this.options.onDocumentReady?.(context());
    return true;
  }

  bindRenderedView(view: unknown, sectionHref?: string): boolean {
    const document = documentFromRenderedView(view);
    return this.bind({
      document: document ?? undefined,
      section: sectionHref ? { href: sectionHref } : undefined,
      window: document?.defaultView ?? undefined,
    });
  }

  bindMounted(container: HTMLElement | null): void {
    for (const frame of container?.querySelectorAll("iframe") ?? []) {
      this.bind({
        document: frame.contentDocument ?? undefined,
        window: frame.contentWindow ?? undefined,
      });
    }
  }

  applyTheme(
    rendition: Rendition | null,
    theme: ReaderContentTheme,
    container: HTMLElement | null,
  ): void {
    if (this.retired) return;
    const themeKey = JSON.stringify(theme);
    const changed = this.themeKey !== themeKey;
    if (!changed && rendition === this.themedRendition) return;
    this.theme = theme;
    this.themeKey = themeKey;
    const documents = changed ? this.livingDocuments() : [];
    for (const document of documents) {
      const registered = this.documents.get(document)!;
      if (registered.prosePrepared) continue;
      prepareReaderRunningProse(document);
      registered.prosePrepared = true;
    }
    applyReaderContentTheme(rendition, theme, documents, false);
    this.themedRendition = rendition;
    this.bindMounted(container);
  }

  applyLayout(layout: ReaderReflowableLayout, container: HTMLElement | null): void {
    if (this.retired) return;
    const layoutKey = this.keyForLayout(layout);
    if (this.layoutKey === layoutKey) return;
    this.layout = layout;
    this.layoutKey = layoutKey;
    this.livingDocuments();
    for (const [document, registered] of this.documents) {
      if (registered.layoutKey === layoutKey) continue;
      applyReaderReflowableLayout(document, layout);
      registered.layoutKey = layoutKey;
    }
    this.bindMounted(container);
  }

  private keyForLayout(layout: ReaderReflowableLayout): string {
    return JSON.stringify([
      layout.mode,
      layout.presentation,
      layout.readingWidth,
      layout.stageSize?.width,
      layout.stageSize?.height,
      this.theme ? readerContentThemeGeometryKey(this.theme) : null,
    ]);
  }

  private livingDocuments(): Document[] {
    for (const document of this.documents.keys()) {
      if (!this.has(document)) this.remove(document);
    }
    return [...this.documents.keys()];
  }

  applyLayoutStageSize(stageSize: ReaderStageSize, container: HTMLElement | null): void {
    if (this.layout?.mode !== "continuous") return;
    this.applyLayout({ ...this.layout, stageSize }, container);
  }

  remove(document: Document): boolean {
    const registered = this.documents.get(document);
    if (!registered) return false;
    this.documents.delete(document);
    this.retiredDocuments.add(document);
    registered.cleanup();
    this.options.onDocumentRemoved?.(document);
    return true;
  }

  removeRenderedView(view: unknown): boolean {
    const document = documentFromRenderedView(view);
    return document ? this.remove(document) : false;
  }

  pruneDisconnected(): void {
    for (const [document, registered] of this.documents) {
      const frame = registered.frame;
      if (frameOwnsDocument(frame, document)) continue;
      this.remove(document);
    }
  }

  clear(): void {
    for (const document of [...this.documents.keys()]) {
      this.remove(document);
    }
  }

  retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.clear();
    this.options = {};
    this.theme = null;
    this.layout = null;
    this.themedRendition = null;
    this.themeKey = null;
    this.layoutKey = null;
  }

  list(): readonly Document[] {
    return [...this.documents.keys()];
  }

  has(document: Document): boolean {
    const registered = this.documents.get(document);
    return Boolean(
      registered && (!registered.frame || frameOwnsDocument(registered.frame, document)),
    );
  }

  clearSelection(document?: Document): void {
    if (document) {
      document.getSelection()?.removeAllRanges();
      return;
    }
    for (const registeredDocument of this.documents.keys()) {
      registeredDocument.getSelection()?.removeAllRanges();
    }
  }

  contextFor(document: Document): ReaderContentDocumentContext | null {
    const registered = this.documents.get(document);
    return registered ? { document, sectionHref: registered.sectionHref } : null;
  }

  renditionTargetIsUsable(rendition: Rendition, target: string): boolean {
    if (typeof rendition.getRange !== "function") return true;
    try {
      const range = rendition.getRange(target, "archeion-highlight");
      const document = range?.startContainer.ownerDocument;
      const frame = document?.defaultView?.frameElement;
      return Boolean(document && this.documents.has(document) && frame?.isConnected);
    } catch {
      return false;
    }
  }
}

export class ReaderContentDocumentSessionOwner {
  private activeRegistry: ReaderContentDocumentRegistry | null = null;
  private options: ReaderContentDocumentRegistryOptions = {};

  readonly access: ReaderContentDocumentAccess = Object.freeze({
    clearSelection: (document?: Document) => this.activeRegistry?.clearSelection(document),
    contextFor: (document: Document) => this.activeRegistry?.contextFor(document) ?? null,
    has: (document: Document) => this.activeRegistry?.has(document) ?? false,
    list: () => this.activeRegistry?.list() ?? [],
    pruneDisconnected: () => this.activeRegistry?.pruneDisconnected(),
    updateOptions: (options: ReaderContentDocumentRegistryOptions) => {
      this.options = options;
      this.activeRegistry?.updateOptions(options);
    },
  });

  activate(): ReaderContentDocumentRegistry {
    this.retire();
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions(this.options);
    this.activeRegistry = registry;
    return registry;
  }

  applyTheme(
    rendition: Rendition | null,
    theme: ReaderContentTheme,
    container: HTMLElement | null,
  ) {
    this.activeRegistry?.applyTheme(rendition, theme, container);
  }

  applyLayout(layout: ReaderReflowableLayout, container: HTMLElement | null): void {
    this.activeRegistry?.applyLayout(layout, container);
  }

  applyLayoutStageSize(stageSize: ReaderStageSize, container: HTMLElement | null): void {
    this.activeRegistry?.applyLayoutStageSize(stageSize, container);
  }

  bindMounted(container: HTMLElement | null): void {
    this.activeRegistry?.bindMounted(container);
  }

  renditionTargetIsUsable(rendition: Rendition, target: string): boolean {
    return this.activeRegistry?.renditionTargetIsUsable(rendition, target) ?? false;
  }

  retire(registry?: ReaderContentDocumentRegistry): void {
    if (!this.activeRegistry || (registry && this.activeRegistry !== registry)) return;
    const retiring = this.activeRegistry;
    this.activeRegistry = null;
    retiring.retire();
  }
}
