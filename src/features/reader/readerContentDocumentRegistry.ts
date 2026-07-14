import type { Rendition } from "epubjs";

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

export type ReaderContentDocumentRegistryOptions = {
  onDocumentRemoved?: (document: Document) => void;
  onEscape?: () => boolean;
  onInteraction?: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onPointerDown?: () => void;
  onSelectionCollapsed?: (document: Document) => void;
  onWheel?: (event: WheelEvent) => void;
};

type RegisteredDocument = {
  cleanup: () => void;
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
    if (!document || this.documents.has(document)) return false;

    if (this.theme) applyReaderContentTheme(null, this.theme, [document]);
    const window = contentWindow(document, content?.window);
    const wheelOptions: AddEventListenerOptions = { capture: true, passive: false };
    const keyOptions: AddEventListenerOptions = { capture: true };

    const onContentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && this.options.onEscape?.()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.options.onKeyDown?.(event);
    };
    const onContentInteraction = () => this.options.onInteraction?.();
    const onContentPointerDown = () => this.options.onPointerDown?.();
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
    document.addEventListener("pointerdown", onContentPointerDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mousemove", onContentInteraction);
    document.addEventListener("touchstart", onContentInteraction);
    document.addEventListener("click", onContentInteraction);
    window?.addEventListener("pagehide", onContentTeardown);

    const cleanup = () => {
      for (const target of wheelTargets) {
        target.removeEventListener("wheel", onContentWheel, wheelOptions);
      }
      document.removeEventListener("keydown", onContentKeyDown, keyOptions);
      document.removeEventListener("pointerdown", onContentPointerDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mousemove", onContentInteraction);
      document.removeEventListener("touchstart", onContentInteraction);
      document.removeEventListener("click", onContentInteraction);
      window?.removeEventListener("pagehide", onContentTeardown);
    };

    this.documents.set(document, { cleanup, window });
    return true;
  }

  bindRenderedView(view: unknown): boolean {
    const document = documentFromRenderedView(view);
    return this.bind({
      document: document ?? undefined,
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
