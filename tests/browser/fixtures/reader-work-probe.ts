import { ReaderContentDocumentRegistry } from "../../../src/features/reader/readerContentDocumentRegistry";
import { RenderedAnnotationAdapter } from "../../../src/features/reader/RenderedAnnotationAdapter";

// Opt-in synthetic-fixture observation of application boundaries. No vendor
// method or input is changed. Numeric records do not retain retired DOM nodes.
export function probeReaderWork() {
  const registry = ReaderContentDocumentRegistry.prototype;
  const originalBind = registry.bind;
  const originalRemove = registry.remove;
  const originalOptions = registry.updateOptions;
  const originalRendered = registry.bindRenderedView;
  const originalReconcile = RenderedAnnotationAdapter.prototype.reconcile;
  const records: Array<{
    section: string;
    proseClassifications: number;
    mediaClassifications: number;
    computedStyles: number;
    preparations: number;
  }> = [];
  const releases = new Map<Document, () => void>();
  const byDocument = new WeakMap<Document, (typeof records)[number]>();
  const renderedBoundaryMs: number[] = [];
  const preparationMs: number[] = [];
  let reconciliations = 0;
  let scrollEvents = 0;

  registry.bind = function (content) {
    const doc = content?.document;
    if (doc && !byDocument.has(doc)) {
      const record = {
        section: doc.title,
        proseClassifications: 0,
        mediaClassifications: 0,
        computedStyles: 0,
        preparations: 0,
      };
      records.push(record);
      byDocument.set(doc, record);
      const query = doc.querySelectorAll;
      const view = doc.defaultView;
      const computed = view?.getComputedStyle;
      doc.querySelectorAll = function (this: Document, selector: string) {
        if (selector === "p") record.proseClassifications++;
        if (selector === "img, svg, video, canvas") record.mediaClassifications++;
        return query.call(this, selector);
      } as typeof doc.querySelectorAll;
      if (view && computed)
        view.getComputedStyle = function (...args) {
          record.computedStyles++;
          return computed.apply(this, args);
        };
      releases.set(doc, () => {
        doc.querySelectorAll = query;
        if (view && computed) view.getComputedStyle = computed;
      });
    }
    return originalBind.call(this, content);
  };
  registry.remove = function (doc) {
    const removed = originalRemove.call(this, doc);
    if (removed) {
      releases.get(doc)?.();
      releases.delete(doc);
    }
    return removed;
  };
  registry.updateOptions = function (options) {
    const ready = options.onDocumentReady;
    return originalOptions.call(this, {
      ...options,
      onDocumentReady: ready
        ? (context) => {
            const record = byDocument.get(context.document);
            if (record) record.preparations++;
            const start = performance.now();
            try {
              ready(context);
            } finally {
              preparationMs.push(performance.now() - start);
            }
          }
        : undefined,
    });
  };
  registry.bindRenderedView = function (...args) {
    const start = performance.now();
    try {
      return originalRendered.apply(this, args);
    } finally {
      renderedBoundaryMs.push(performance.now() - start);
    }
  };
  RenderedAnnotationAdapter.prototype.reconcile = function () {
    reconciliations++;
    return originalReconcile.call(this);
  };
  const scroll = (event: Event) => {
    if ((event.target as Element | null)?.classList?.contains("epub-container")) scrollEvents++;
  };
  document.addEventListener("scroll", scroll, { capture: true, passive: true });

  return {
    snapshot: () => ({
      documents: records.map((record) => ({ ...record })),
      observedLivingDocuments: releases.size,
      reconciliations,
      renderedBoundaryMs: [...renderedBoundaryMs],
      preparationMs: [...preparationMs],
      // Public outer scroll events are a surrogate for vendor SCROLLED frequency.
      scrollEvents,
    }),
    dispose: () => {
      registry.bind = originalBind;
      registry.remove = originalRemove;
      registry.updateOptions = originalOptions;
      registry.bindRenderedView = originalRendered;
      RenderedAnnotationAdapter.prototype.reconcile = originalReconcile;
      document.removeEventListener("scroll", scroll, true);
      for (const release of releases.values()) release();
      releases.clear();
    },
  };
}
