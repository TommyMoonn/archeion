import {
  ArrowsOutSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  X,
} from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { ResolvedEpubIllustration } from "./epubIllustrationResolver";

const READER_ILLUSTRATION_MIN_ZOOM = 0.25;
const READER_ILLUSTRATION_MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const KEYBOARD_PAN_STEP = 56;

type ReaderIllustrationViewerProps = Readonly<{
  error?: string;
  loading: boolean;
  onClose: () => void;
  resource?: ResolvedEpubIllustration;
}>;

type PanOrigin = Readonly<{ left: number; top: number; x: number; y: number }>;

export function ReaderIllustrationViewer({
  error,
  loading,
  onClose,
  resource,
}: ReaderIllustrationViewerProps) {
  return (
    <ReaderIllustrationViewerInstance
      key={resource?.url ?? (loading ? "loading" : (error ?? "empty"))}
      error={error}
      loading={loading}
      onClose={onClose}
      resource={resource}
    />
  );
}

function ReaderIllustrationViewerInstance({
  error,
  loading,
  onClose,
  resource,
}: ReaderIllustrationViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanOrigin | null>(null);
  const [zoom, setZoom] = useState<"fit" | number>("fit");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog?.open) dialog.close();
    };
  }, []);

  function updateZoom(direction: -1 | 1) {
    setZoom((current) =>
      clampIllustrationZoom((current === "fit" ? 1 : current) + direction * ZOOM_STEP),
    );
  }

  function fitToViewport() {
    setZoom("fit");
    resetPan(viewportRef.current);
  }

  function showActualSize() {
    setZoom(1);
    resetPan(viewportRef.current);
  }

  function panBy(left: number, top: number) {
    viewportRef.current?.scrollBy({ behavior: "auto", left, top });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case "+":
      case "=":
        event.preventDefault();
        event.stopPropagation();
        updateZoom(1);
        break;
      case "-":
        event.preventDefault();
        event.stopPropagation();
        updateZoom(-1);
        break;
      case "0":
        event.preventDefault();
        event.stopPropagation();
        fitToViewport();
        break;
      case "ArrowLeft":
        event.preventDefault();
        event.stopPropagation();
        panBy(-KEYBOARD_PAN_STEP, 0);
        break;
      case "ArrowRight":
        event.preventDefault();
        event.stopPropagation();
        panBy(KEYBOARD_PAN_STEP, 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        panBy(0, -KEYBOARD_PAN_STEP);
        break;
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        panBy(0, KEYBOARD_PAN_STEP);
        break;
    }
  }

  function beginPan(event: PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport || zoom === "fit" || event.button !== 0) return;
    event.preventDefault();
    panRef.current = {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const origin = panRef.current;
    if (!viewport || !origin) return;
    viewport.scrollLeft = origin.left - (event.clientX - origin.x);
    viewport.scrollTop = origin.top - (event.clientY - origin.y);
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const imageStyle =
    resource && zoom !== "fit"
      ? ({
          height: `${resource.height * zoom}px`,
          width: `${resource.width * zoom}px`,
        } satisfies CSSProperties)
      : undefined;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="reader-illustration-title"
      className="reader-illustration-viewer"
      data-reader-ignore-shortcuts
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="reader-illustration-viewer__panel">
        <header className="reader-illustration-viewer__header">
          <div>
            <h2 id="reader-illustration-title">Illustration</h2>
            {resource ? (
              <p>
                {resource.width} × {resource.height} · {mediaTypeLabel(resource.mediaType)}
              </p>
            ) : null}
          </div>
          <IconButton label="Close illustration" onClick={onClose} ref={closeRef}>
            <X aria-hidden="true" />
          </IconButton>
        </header>

        <div
          ref={viewportRef}
          aria-busy={loading || undefined}
          aria-label="Illustration viewport"
          className="reader-illustration-viewer__viewport"
          data-pannable={zoom !== "fit" || undefined}
          onPointerCancel={endPan}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          tabIndex={0}
        >
          {loading ? <p role="status">Opening illustration…</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {resource ? (
            <img
              alt="EPUB illustration"
              className={zoom === "fit" ? "is-fit" : undefined}
              draggable={false}
              src={resource.url}
              style={imageStyle}
            />
          ) : null}
        </div>

        <footer className="reader-illustration-viewer__controls">
          <div className="reader-illustration-viewer__zoom-controls">
            <IconButton
              disabled={!resource || zoom === READER_ILLUSTRATION_MIN_ZOOM}
              label="Zoom out"
              onClick={() => updateZoom(-1)}
            >
              <MagnifyingGlassMinus aria-hidden="true" />
            </IconButton>
            <output aria-live="polite">{zoom === "fit" ? "Fit" : `${zoom * 100}%`}</output>
            <IconButton
              disabled={!resource || zoom === READER_ILLUSTRATION_MAX_ZOOM}
              label="Zoom in"
              onClick={() => updateZoom(1)}
            >
              <MagnifyingGlassPlus aria-hidden="true" />
            </IconButton>
          </div>
          <div className="reader-illustration-viewer__size-controls">
            <Button disabled={!resource} onClick={fitToViewport} variant="secondary">
              Fit to viewport
            </Button>
            <Button
              disabled={!resource}
              icon={<ArrowsOutSimple aria-hidden="true" />}
              onClick={showActualSize}
              variant="secondary"
            >
              Actual size
            </Button>
            <Button disabled={!resource} onClick={fitToViewport} variant="ghost">
              Reset
            </Button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

function clampIllustrationZoom(value: number): number {
  return Math.min(Math.max(value, READER_ILLUSTRATION_MIN_ZOOM), READER_ILLUSTRATION_MAX_ZOOM);
}

function resetPan(viewport: HTMLDivElement | null) {
  viewport?.scrollTo({ behavior: "auto", left: 0, top: 0 });
}

function mediaTypeLabel(mediaType: string): string {
  return mediaType.slice("image/".length).toUpperCase();
}
