import {
  ArrowsOutSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { ResolvedEpubIllustration } from "./epubIllustrationResolver";
import { useReaderIllustrationInteraction } from "./useReaderIllustrationInteraction";

type ReaderIllustrationViewerProps = Readonly<{
  error?: string;
  loading: boolean;
  onClose: () => void;
  resource?: ResolvedEpubIllustration;
}>;

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
  const interaction = useReaderIllustrationInteraction(resource, dialogRef, viewportRef);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog?.open) dialog.close();
    };
  }, []);

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
      onKeyDown={interaction.handleKeyDown}
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
          aria-label={interaction.viewportLabel}
          className="reader-illustration-viewer__viewport"
          data-pannable={interaction.pannable || undefined}
          onLostPointerCapture={interaction.handleLostPointerCapture}
          onPointerCancel={interaction.handlePointerCancel}
          onPointerDown={interaction.handlePointerDown}
          onPointerMove={interaction.handlePointerMove}
          onPointerUp={interaction.handlePointerUp}
          tabIndex={0}
        >
          <div className="reader-illustration-viewer__canvas" style={interaction.canvasStyle}>
            {loading ? <p role="status">Opening illustration…</p> : null}
            {error ? <p role="alert">{error}</p> : null}
            {resource ? (
              <img
                alt="EPUB illustration"
                draggable={false}
                src={resource.url}
                style={interaction.imageStyle}
              />
            ) : null}
          </div>
        </div>

        <footer className="reader-illustration-viewer__controls">
          <div className="reader-illustration-viewer__zoom-controls">
            <IconButton
              disabled={!interaction.canZoomOut}
              label="Zoom out"
              onClick={interaction.zoomOut}
            >
              <MagnifyingGlassMinus aria-hidden="true" />
            </IconButton>
            <output aria-live="polite">{interaction.zoomLabel}</output>
            <IconButton
              disabled={!interaction.canZoomIn}
              label="Zoom in"
              onClick={interaction.zoomIn}
            >
              <MagnifyingGlassPlus aria-hidden="true" />
            </IconButton>
          </div>
          <div className="reader-illustration-viewer__size-controls">
            <Button disabled={!resource} onClick={interaction.fitToViewport} variant="secondary">
              Fit to viewport
            </Button>
            <Button
              disabled={!resource}
              icon={<ArrowsOutSimple aria-hidden="true" />}
              onClick={interaction.showActualSize}
              variant="secondary"
            >
              Actual size
            </Button>
            <Button disabled={!resource} onClick={interaction.fitToViewport} variant="ghost">
              Reset
            </Button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

function mediaTypeLabel(mediaType: string): string {
  return mediaType.slice("image/".length).toUpperCase();
}
