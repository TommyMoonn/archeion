import { useId, type CSSProperties } from "react";

import type { ResolvedAppTheme } from "../../themes/domain";

type ThemeShellPreviewProps = Readonly<{ theme: ResolvedAppTheme }>;

export function ThemeShellPreview({ theme }: ThemeShellPreviewProps) {
  const id = useId();
  const captionId = `${id}-caption`;
  const descriptionId = `${id}-description`;
  const style = {
    "--theme-shell-canvas": theme.tokens.canvas,
    "--theme-shell-frame": theme.tokens.frame,
    "--theme-shell-sidebar": theme.tokens.sidebar,
    "--theme-shell-main": theme.tokens.main,
    "--theme-shell-surface-raised": theme.tokens.surfaceRaised,
    "--theme-shell-line-subtle": theme.tokens.lineSubtle,
    "--theme-shell-text": theme.tokens.text,
    "--theme-shell-text-strong": theme.tokens.textStrong,
    "--theme-shell-muted": theme.tokens.muted,
    "--theme-shell-accent": theme.tokens.accent,
  } as CSSProperties;

  return (
    <figure className="theme-shell-preview">
      <figcaption id={captionId}>Application shell preview</figcaption>
      <p className="sr-only" id={descriptionId}>
        Representative window chrome above navigation and workspace planes, separated by a quiet
        divider, with a raised content surface. This preview is not interactive.
      </p>
      <div
        aria-describedby={descriptionId}
        aria-labelledby={captionId}
        className="theme-shell-preview__graphic"
        role="img"
        style={style}
      >
        <div aria-hidden="true">
          <div className="theme-shell-preview__chrome">Window chrome</div>
          <div className="theme-shell-preview__planes">
            <div className="theme-shell-preview__navigation">
              <span>Navigation</span>
              <div className="theme-shell-preview__accent-mark" />
              <div className="theme-shell-preview__navigation-line" />
              <div className="theme-shell-preview__navigation-line" />
            </div>
            <div className="theme-shell-preview__workspace">
              <strong>Workspace</strong>
              <div className="theme-shell-preview__content">
                <span>Content</span>
                <span className="theme-shell-preview__secondary">Secondary text</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
