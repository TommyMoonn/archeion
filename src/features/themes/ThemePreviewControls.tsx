import { Checkbox } from "../../components/ui/checkbox";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { Button } from "../../components/Button";
import { useTransientSurfaceOwnership } from "../../utils/transientSurfaceOwnership";
import type { ThemePreviewSession } from "../../themes/ThemePreviewSession";

type ThemePreviewControlsProps = Readonly<{
  session: ThemePreviewSession;
}>;

export function ThemePreviewControls({ session }: ThemePreviewControlsProps) {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const surfaceRef = useRef<HTMLElement>(null);
  const revertButton = useRef<HTMLButtonElement>(null);
  const wasIdle = useRef(true);

  useEffect(() => {
    if (snapshot.status !== "idle" && wasIdle.current) revertButton.current?.focus();
    wasIdle.current = snapshot.status === "idle";
  }, [snapshot.status]);

  useTransientSurfaceOwnership({
    active: snapshot.status !== "idle" && snapshot.status !== "keeping",
    elementRef: surfaceRef,
    kind: "inline-editor",
    onDismiss: (reason) => {
      if (reason === "escape") session.revert();
    },
  });

  if (snapshot.status === "idle") return null;

  const hasWarnings = snapshot.contrastWarnings.length > 0;
  const keeping = snapshot.status === "keeping";
  const keepBlocked = hasWarnings && !snapshot.warningsAcknowledged;

  return (
    <aside
      aria-label="Theme preview controls"
      className="row-start-4 mx-theme-window mb-theme-window mt-theme-window-narrow flex items-center gap-theme-header-top border-0 border-t border-solid border-line-subtle bg-transparent px-control-inset pt-theme-header text-text forced-colors:border-system-canvas-text theme-preview-controls-stacked:mx-theme-window-narrow theme-preview-controls-stacked:mb-theme-window-narrow theme-preview-controls-stacked:grid theme-preview-controls-stacked:gap-sidebar-inset"
      ref={surfaceRef}
    >
      <div className="grid min-w-0 gap-theme-catalog-gap" aria-live="polite">
        <p className="m-0 text-caption-size font-semibold uppercase tracking-details-label text-accent">
          Theme preview
        </p>
        <strong className="m-0 truncate text-body-only text-text-strong">
          {snapshot.candidate.name}
        </strong>
        {snapshot.error ? (
          // Retain the browser's forced-color text adjustment alongside the shared Mark fill.
          <span
            className="m-0 text-meta-only text-error-strong forced-colors:text-error-strong!"
            data-tone="error"
            role="alert"
          >
            {snapshot.error}
          </span>
        ) : null}
        {hasWarnings ? (
          <label className="mt-control-gap-compact flex items-start gap-field-label text-meta-only leading-theme-warning text-warning">
            <Checkbox
              className="mt-control-inset"
              checked={snapshot.warningsAcknowledged}
              disabled={keeping}
              onCheckedChange={(checked) => session.acknowledgeWarnings(checked)}
            />
            <span>
              I understand this theme has {snapshot.contrastWarnings.length} contrast warning
              {snapshot.contrastWarnings.length === 1 ? "" : "s"}.
            </span>
          </label>
        ) : null}
      </div>
      <div className="ms-auto flex flex-none items-center gap-control-gap theme-preview-controls-stacked:ms-0 theme-preview-controls-stacked:grid theme-preview-controls-stacked:grid-cols-theme-preview-actions">
        <Button
          className="theme-preview-controls-stacked:w-full"
          disabled={keeping}
          onClick={() => session.revert()}
          ref={revertButton}
          size="standard"
          variant="secondary"
        >
          Revert
        </Button>
        <Button
          className="theme-preview-controls-stacked:w-full"
          busy={keeping}
          disabled={keeping || keepBlocked}
          disabledReason={
            keepBlocked ? "Acknowledge the contrast warning before using this theme." : undefined
          }
          onClick={() => void session.keep()}
          size="standard"
        >
          {keeping ? "Applying" : "Use theme"}
        </Button>
      </div>
    </aside>
  );
}
