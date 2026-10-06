import type { CSSProperties } from "react";

import type { ResolvedAppTheme } from "../../themes/domain";

type ThemeShellGraphicProps = Readonly<{ theme: ResolvedAppTheme }> &
  (
    | Readonly<{ compact: true }>
    | Readonly<{ compact?: false; captionId: string; descriptionId: string }>
  );

export function ThemeShellGraphic(props: ThemeShellGraphicProps) {
  const { theme, compact } = props;
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
    <span
      aria-describedby={compact ? undefined : props.descriptionId}
      aria-hidden={compact || undefined}
      aria-labelledby={compact ? undefined : props.captionId}
      className="theme-shell-preview__graphic"
      data-preview-size={compact ? "compact" : undefined}
      role={compact ? undefined : "img"}
      style={style}
    >
      <span aria-hidden="true">
        {!compact ? <span className="theme-shell-preview__chrome">Window chrome</span> : null}
        <span className="theme-shell-preview__planes">
          <span className="theme-shell-preview__navigation">
            {!compact ? <span>Navigation</span> : null}
            <span className="theme-shell-preview__accent-mark" />
            <span className="theme-shell-preview__navigation-line" />
            {!compact ? <span className="theme-shell-preview__navigation-line" /> : null}
          </span>
          <span className="theme-shell-preview__workspace">
            {compact ? (
              <span className="theme-shell-preview__text-line" />
            ) : (
              <strong>Workspace</strong>
            )}
            <span className="theme-shell-preview__content">
              {compact ? (
                <>
                  <span className="theme-shell-preview__text-line" />
                  <span className="theme-shell-preview__navigation-line" />
                </>
              ) : (
                <>
                  <span>Content</span>
                  <span className="theme-shell-preview__secondary">Secondary text</span>
                </>
              )}
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
