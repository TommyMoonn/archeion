import type { Rendition } from "epubjs";

export type ReaderStageSize = Readonly<{
  height: number;
  width: number;
}>;

/** Wait for font layout and two paint opportunities, with explicit supersession. */
export function afterReaderStageLayout(
  documents: readonly Document[],
  apply: () => void,
): () => void {
  let cancelled = false;
  let frame: number | null = null;
  void Promise.allSettled(documents.map((document) => document.fonts?.ready)).then(() => {
    if (cancelled) return;
    frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!cancelled) apply();
      });
    });
  });
  return () => {
    cancelled = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}

type LocationPreservingRendition = Rendition & {
  resize(width: number, height: number, epubcfi: string): void;
};

export function syncReaderRenditionStageSize(
  rendition: Rendition,
  stageSize: ReaderStageSize,
  preserveCfi?: string,
): void {
  if (!isUsableReaderStageSize(stageSize)) return;
  if (preserveCfi) {
    (rendition as LocationPreservingRendition).resize(
      stageSize.width,
      stageSize.height,
      preserveCfi,
    );
    return;
  }
  rendition.resize(stageSize.width, stageSize.height);
}

export function observeReaderStageSize(
  stage: HTMLElement,
  onSize: (size: ReaderStageSize) => void,
): () => void {
  let lastSize: ReaderStageSize | null = null;
  let pendingSize: ReaderStageSize | null = null;
  let frame: number | null = null;

  const publish = (width: number, height: number) => {
    const nextSize = normalizeReaderStageSize(width, height);
    if (!nextSize || sameReaderStageSize(lastSize, nextSize)) return;
    lastSize = nextSize;
    onSize(nextSize);
  };
  const publishStageBounds = () => {
    const bounds = stage.getBoundingClientRect();
    publish(bounds.width, bounds.height);
  };

  publishStageBounds();

  const schedule = (width: number, height: number) => {
    pendingSize = normalizeReaderStageSize(width, height);
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      const size = pendingSize;
      pendingSize = null;
      if (size) publish(size.width, size.height);
    });
  };
  const scheduleStageBounds = () => {
    const bounds = stage.getBoundingClientRect();
    schedule(bounds.width, bounds.height);
  };
  const cancel = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    pendingSize = null;
  };

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === stage);
      if (entry) schedule(entry.contentRect.width, entry.contentRect.height);
      else scheduleStageBounds();
    });
    observer.observe(stage);
    return () => {
      cancel();
      observer.disconnect();
    };
  }

  window.addEventListener("resize", scheduleStageBounds);
  return () => {
    cancel();
    window.removeEventListener("resize", scheduleStageBounds);
  };
}

function normalizeReaderStageSize(width: number, height: number): ReaderStageSize | null {
  const normalized = Object.freeze({
    height: Math.round(height),
    width: Math.round(width),
  });
  return isUsableReaderStageSize(normalized) ? normalized : null;
}

function isUsableReaderStageSize(size: ReaderStageSize): boolean {
  return (
    Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
  );
}

function sameReaderStageSize(left: ReaderStageSize | null, right: ReaderStageSize): boolean {
  return left?.width === right.width && left.height === right.height;
}
