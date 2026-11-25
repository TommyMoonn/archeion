export const statusToneTextClass = {
  success: "text-success",
  warning: "text-accent-strong",
  error: "text-error",
} as const;

export const statusToneClass = {
  success: `${statusToneTextClass.success} border-success-border bg-status-success`,
  warning: `${statusToneTextClass.warning} border-accent-border bg-status-warning`,
  error: `${statusToneTextClass.error} border-error-border bg-status-error`,
} as const;

export const statusActionsClass =
  "reader-status-page__actions flex flex-wrap items-center justify-center gap-button-standard mt-dialog-panel";
export const statusLinkClass =
  "text-link inline-flex items-center gap-control-gap text-accent-strong text-body font-medium no-underline";
export const statusCodeClass =
  "status-page__code m-0 text-accent text-code font-bold tracking-settings-eyebrow";

export const appearanceNoticeClass =
  "appearance-status--visible fixed z-1500 top-12 end-4 max-w-appearance-notice max-h-appearance-notice-height overflow-auto p-4 border-standard border-solid border-line rounded-control text-text bg-canvas shadow-app-popover";
