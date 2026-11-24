// The native frame is shared by standalone, hosted and Reader link dialogs.
export const dialogFrameClass =
  "dialog w-dialog-frame max-w-none max-h-dialog-frame-height origin-center overflow-hidden rounded-dialog border-standard border-solid border-line bg-surface-main p-0 text-text shadow-app-dialog dialog-viewport-narrow:w-dialog-frame-narrow dialog-viewport-narrow:max-h-dialog-frame-height-narrow app-motion:open:animate-dialog-enter app-motion:open:data-[surface-state=closing]:animate-dialog-exit [&_.button]:min-h-control-standard [&_.button]:gap-control-gap [&_.button]:px-button-standard [&_.button]:text-meta [&_.button]:font-medium";

export const dialogPanelClass =
  "dialog__panel @container/dialog-panel box-border flex max-h-dialog-panel-height flex-col overflow-hidden p-dialog-panel dialog-viewport-narrow:max-h-dialog-panel-height-narrow dialog-viewport-narrow:p-dialog-gap";

export const dialogCopyClass =
  "dialog__copy constrained-user-content grid min-w-0 flex-none gap-dialog-copy";

export const dialogTitleClass = "m-0 font-app-display text-dialog-title text-text-strong";

export const dialogRegionClass =
  "min-h-0 min-w-0 overflow-y-auto wrap-anywhere overscroll-contain scrollbar-gutter-stable p-control-inset";

export const dialogBodyClass = `dialog__body ${dialogRegionClass} mt-dialog-gap flex-auto dialog-viewport-narrow:mt-dialog-gap-narrow`;

export const dialogFooterClass =
  "dialog__footer flex min-w-0 flex-wrap justify-end gap-dialog-footer self-center only:col-span-full [&>.button--ghost:first-child]:me-auto dialog-panel-narrow:grid dialog-panel-narrow:grid-cols-1 dialog-panel-narrow:[&>.button]:w-full dialog-panel-narrow:[&>.button]:min-w-0 dialog-panel-narrow:[&>.button]:whitespace-normal dialog-panel-narrow:[&>.button--ghost:first-child]:me-0";
