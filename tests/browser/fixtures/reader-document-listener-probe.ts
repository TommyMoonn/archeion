import { ReaderContentDocumentRegistry } from "../../../src/features/reader/readerContentDocumentRegistry";

// Observe only registrations made by the production registry. Retaining targets
// here is deliberate test instrumentation, not a heap or GC measurement.
export function probeReaderDocumentListeners() {
  const originalBind = ReaderContentDocumentRegistry.prototype.bind;
  const registrations = new Map<EventTarget, Set<EventListenerOrEventListenerObject>>();
  const documents = new Set<Document>();
  const windowDocuments = new Map<EventTarget, Document>();
  const releases: Array<() => void> = [];
  let binding = false;
  function observe(target: EventTarget) {
    if (registrations.has(target)) return;
    const listeners = new Set<EventListenerOrEventListenerObject>();
    registrations.set(target, listeners);
    const add = target.addEventListener;
    const remove = target.removeEventListener;
    target.addEventListener = (type, listener, options) => {
      if (binding && listener) listeners.add(listener);
      add.call(target, type, listener, options);
    };
    target.removeEventListener = (type, listener, options) => {
      if (listener) listeners.delete(listener);
      remove.call(target, type, listener, options);
    };
    releases.push(() => {
      target.addEventListener = add;
      target.removeEventListener = remove;
    });
  }
  ReaderContentDocumentRegistry.prototype.bind = function (content) {
    if (content?.document) {
      const doc = content.document;
      documents.add(doc);
      observe(doc);
      const window = content.window ?? doc.defaultView;
      if (window) {
        windowDocuments.set(window, doc);
        observe(window);
      }
    }
    binding = true;
    try {
      return originalBind.call(this, content);
    } finally {
      binding = false;
    }
  };
  return {
    snapshot: () => {
      let listeners = 0;
      let retiredListeners = 0;
      let livingDocuments = 0;
      for (const [target, callbacks] of registrations) {
        listeners += callbacks.size;
        const doc = windowDocuments.get(target) ?? (target as Document);
        if (!doc.defaultView?.frameElement?.isConnected) retiredListeners += callbacks.size;
      }
      for (const doc of documents)
        if (doc.defaultView?.frameElement?.isConnected && registrations.get(doc)?.size)
          livingDocuments += 1;
      return {
        listeners,
        retiredListeners,
        livingDocuments,
        visitedDocuments: documents.size,
        mountedFrames: document.querySelectorAll(".epub-viewer iframe").length,
      };
    },
    dispose: () => {
      ReaderContentDocumentRegistry.prototype.bind = originalBind;
      for (const release of releases) release();
      registrations.clear();
      documents.clear();
      windowDocuments.clear();
    },
  };
}
