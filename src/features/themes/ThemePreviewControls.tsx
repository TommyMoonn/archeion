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
    <aside aria-label="Theme preview controls" className="theme-preview-controls" ref={surfaceRef}>
      <div className="theme-preview-controls__copy" aria-live="polite">
        <p>Theme preview</p>
        <strong>{snapshot.candidate.name}</strong>
        {snapshot.error ? (
          <span data-tone="error" role="alert">
            {snapshot.error}
          </span>
        ) : null}
        {hasWarnings ? (
          <label className="theme-preview-controls__warning">
            <input
              checked={snapshot.warningsAcknowledged}
              disabled={keeping}
              onChange={(event) => session.acknowledgeWarnings(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>
              I understand this theme has {snapshot.contrastWarnings.length} contrast warning
              {snapshot.contrastWarnings.length === 1 ? "" : "s"}.
            </span>
          </label>
        ) : null}
      </div>
      <div className="theme-preview-controls__actions">
        <Button
          disabled={keeping}
          onClick={() => session.revert()}
          ref={revertButton}
          size="standard"
          variant="secondary"
        >
          Revert
        </Button>
        <Button
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
