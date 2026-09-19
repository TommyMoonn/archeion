import type { Rendition } from "epubjs";

export type ReaderStageSize = Readonly<{
  height: number;
  width: number;
}>;

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

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === stage);
      if (entry) publish(entry.contentRect.width, entry.contentRect.height);
      else publishStageBounds();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }

  window.addEventListener("resize", publishStageBounds);
  return () => window.removeEventListener("resize", publishStageBounds);
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
