import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";

import { Button } from "../../components/Button";
import { resolveBuiltInAppTheme } from "../../themes/resolveTheme";
import { themePreviewSession } from "../../themes/themePreviewSessionInstance";
import type { ThemePreviewSession } from "../../themes/ThemePreviewSession";
import { appThemeResolvedTokenRegistry } from "../../themes/themeTokenRegistry";

type ThemePreviewControlsProps = Readonly<{
  session?: ThemePreviewSession;
}>;

type SafePreviewStyle = CSSProperties & Record<`--${string}`, string>;

const SAFE_CONTROL_STYLE = createSafeControlStyle();

export function ThemePreviewControls({ session = themePreviewSession }: ThemePreviewControlsProps) {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const revertButton = useRef<HTMLButtonElement>(null);
  const wasIdle = useRef(true);

  useEffect(() => {
    if (snapshot.status !== "idle" && wasIdle.current) revertButton.current?.focus();
    wasIdle.current = snapshot.status === "idle";
  }, [snapshot.status]);

  useEffect(() => {
    if (snapshot.status === "idle" || snapshot.status === "keeping") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      session.revert();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [session, snapshot.status]);

  if (snapshot.status === "idle") return null;

  const hasWarnings = snapshot.contrastWarnings.length > 0;
  const keeping = snapshot.status === "keeping";
  const keepBlocked = hasWarnings && !snapshot.warningsAcknowledged;

  return (
    <aside
      aria-label="Theme preview controls"
      className="theme-preview-controls"
      style={SAFE_CONTROL_STYLE}
    >
      <div className="theme-preview-controls__copy" aria-live="polite">
        <p>Theme preview</p>
        <strong>{snapshot.candidate.name}</strong>
        <span>Temporary until you keep it.</span>
        {snapshot.error ? <span role="alert">{snapshot.error}</span> : null}
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
            keepBlocked ? "Acknowledge the contrast warning before keeping." : undefined
          }
          onClick={() => void session.keep()}
          size="standard"
        >
          {keeping ? "Keeping" : "Keep theme"}
        </Button>
      </div>
    </aside>
  );
}

function createSafeControlStyle(): SafePreviewStyle {
  const safeTheme = resolveBuiltInAppTheme("dark");
  const properties: Record<`--${string}`, string> = {};
  for (const [token, definition] of Object.entries(appThemeResolvedTokenRegistry)) {
    properties[definition.cssVariable] =
      safeTheme.tokens[token as keyof typeof appThemeResolvedTokenRegistry];
  }
  return Object.freeze({ ...properties, colorScheme: "dark" });
}
