import type { Rendition } from "epubjs";

import { focusPresentationRuntime } from "../../app/inputModality";
import { claimTransientSurfaceEscape } from "../../utils/transientSurfaceOwnership";
import { applyReaderContentTheme, type ReaderContentTheme } from "./readerTheme";

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
  sectionHref?: string;
  window: Window | null;
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

export class ReaderContentDocumentRegistry {
  private documents = new Map<Document, RegisteredDocument>();
  private options: ReaderContentDocumentRegistryOptions = {};
  private theme: ReaderContentTheme | null = null;

  updateOptions(options: ReaderContentDocumentRegistryOptions): void {
    this.options = options;
  }

  bind(content: EpubContent | null): boolean {
    const document = content?.document ?? null;
    if (!document) return false;
    const existing = this.documents.get(document);
    if (existing) {
      if (content?.section?.href) existing.sectionHref = content.section.href;
      return false;
    }

    if (this.theme) applyReaderContentTheme(null, this.theme, [document]);
    const window = contentWindow(document, content?.window);
    const wheelOptions: AddEventListenerOptions = { capture: true, passive: false };
    const keyOptions: AddEventListenerOptions = { capture: true };

    const onContentKeyDown = (event: KeyboardEvent) => {
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
      sectionHref: this.documents.get(document)?.sectionHref ?? content?.section?.href,
    });
    const onContentClick = (event: MouseEvent) => {
      if (this.options.onContentClick?.(event, context())) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    };
    const onContentPointerDown = (event: PointerEvent) => {
      focusPresentationRuntime.markPointer();
      if (this.options.onContentPointerDown?.(event, context())) return;
      this.options.onPointerDown?.();
    };
    const onContentTeardown = () => this.remove(document);
    const onSelectionChange = () => {
      if (document.getSelection()?.isCollapsed) {
        this.options.onSelectionCollapsed?.(document);
      }
    };
    const onContentWheel: EventListener = (event) => this.options.onWheel?.(event as WheelEvent);
    const wheelTargets: Array<Window | Document> = window ? [window, document] : [document];

    for (const target of wheelTargets) {
      target.addEventListener("wheel", onContentWheel, wheelOptions);
    }
    document.addEventListener("keydown", onContentKeyDown, keyOptions);
    document.addEventListener("click", onContentClick, true);
    document.addEventListener("pointerdown", onContentPointerDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    window?.addEventListener("pagehide", onContentTeardown);

    const cleanup = () => {
      for (const target of wheelTargets) {
        target.removeEventListener("wheel", onContentWheel, wheelOptions);
      }
      document.removeEventListener("keydown", onContentKeyDown, keyOptions);
      document.removeEventListener("click", onContentClick, true);
      document.removeEventListener("pointerdown", onContentPointerDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      window?.removeEventListener("pagehide", onContentTeardown);
    };

    this.documents.set(document, { cleanup, sectionHref: content?.section?.href, window });
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
    this.theme = theme;
    const mountedDocuments = Array.from(
      container?.querySelectorAll("iframe") ?? [],
      (frame) => frame.contentDocument,
    );
    applyReaderContentTheme(rendition, theme, [...this.documents.keys(), ...mountedDocuments]);
  }

  remove(document: Document): boolean {
    const registered = this.documents.get(document);
    if (!registered) return false;
    this.documents.delete(document);
    registered.cleanup();
    this.options.onDocumentRemoved?.(document);
    return true;
  }

  pruneDisconnected(): void {
    for (const [document, registered] of this.documents) {
      const frame = registered.window?.frameElement ?? document.defaultView?.frameElement;
      if (frame?.isConnected) continue;
      this.remove(document);
    }
  }

  clear(): void {
    for (const document of [...this.documents.keys()]) {
      this.remove(document);
    }
  }

  list(): readonly Document[] {
    return [...this.documents.keys()];
  }

  has(document: Document): boolean {
    return this.documents.has(document);
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
    retiring.clear();
  }
}
