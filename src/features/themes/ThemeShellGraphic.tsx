import type { CSSProperties } from "react";

import type { ResolvedAppTheme } from "../../themes/domain";

type ThemeShellGraphicProps = Readonly<{ theme: ResolvedAppTheme }> &
  (
    | Readonly<{ compact: true }>
    | Readonly<{ compact?: false; captionId: string; descriptionId: string }>
  );

const secondaryLineClass =
  "h-busy-inset w-theme-preview-rule bg-theme-preview-muted forced-colors:bg-system-canvas-text";
const textLineClass = "h-theme-preview-stroke w-theme-preview-text-line";

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
      className={`@container/theme-shell-preview block w-full min-w-0 overflow-hidden wrap-anywhere border-standard border-solid border-line bg-theme-preview-canvas text-caption-size leading-field-standard text-theme-preview-text forced-colors:border-system-canvas-text ${compact ? "col-span-full h-theme-preview-thumbnail rounded-small" : "rounded-control"}`}
      data-preview-size={compact ? "compact" : undefined}
      role={compact ? undefined : "img"}
      style={style}
    >
      <span aria-hidden="true" className={compact ? "block h-full" : undefined}>
        {!compact ? (
          <span
            className="block border-0 border-solid bg-theme-preview-frame px-sidebar-inset py-control-gap text-theme-preview-muted forced-colors:border-be-standard forced-colors:border-system-canvas-text"
            data-preview-part="chrome"
          >
            Window chrome
          </span>
        ) : null}
        <span
          className={`grid ${
            compact
              ? "h-full grid-cols-theme-preview-thumbnail"
              : "grid-cols-theme-preview theme-preview-stacked:grid-cols-1"
          }`}
        >
          <span
            className={`grid min-w-0 content-start border-0 border-e border-solid border-theme-preview-divider bg-theme-preview-sidebar text-theme-preview-text forced-colors:border-system-canvas-text ${
              compact
                ? "gap-control-gap-compact p-control-gap"
                : "gap-sidebar-inset p-sidebar-inset theme-preview-stacked:grid-cols-theme-preview-navigation theme-preview-stacked:items-center theme-preview-stacked:border-e-0 theme-preview-stacked:border-be-standard"
            }`}
            data-preview-part="navigation"
          >
            {!compact ? <span>Navigation</span> : null}
            <span
              className="h-theme-preview-mark w-icon-slot-standard rounded-pill bg-theme-preview-accent forced-colors:bg-system-canvas-text"
              data-preview-part="accent"
            />
            <span className={secondaryLineClass} />
            {!compact ? <span className={secondaryLineClass} /> : null}
          </span>
          <span
            className={`grid min-w-0 content-start bg-theme-preview-main ${
              compact
                ? "gap-control-gap-compact p-control-gap"
                : "gap-sidebar-inset p-sidebar-inset"
            }`}
            data-preview-part="workspace"
          >
            {compact ? (
              <span
                className={`${textLineClass} bg-theme-preview-strong forced-colors:bg-system-canvas-text`}
                data-preview-part="title"
              />
            ) : (
              <strong className="text-theme-preview-strong" data-preview-part="title">
                Workspace
              </strong>
            )}
            <span
              className={`grid min-w-0 gap-theme-preview-mark rounded-small bg-theme-preview-raised forced-colors:outline-1 forced-colors:outline-system-canvas-text ${compact ? "p-control-gap-compact" : "p-theme-catalog-block"}`}
              data-preview-part="content"
            >
              {compact ? (
                <>
                  <span className={`${textLineClass} bg-theme-preview-text`} />
                  <span className={secondaryLineClass} />
                </>
              ) : (
                <>
                  <span>Content</span>
                  <span className="text-theme-preview-muted" data-preview-part="secondary">
                    Secondary text
                  </span>
                </>
              )}
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
