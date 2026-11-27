export const detailsFrame =
  "border-0 border-s border-solid border-line-subtle bg-surface-main text-text @container/book-details";

export const detailsPanel = "flex h-full flex-col";

export const detailsResizeHandle =
  "book-details-resize-handle start-0 hover:border-s hover:border-solid hover:border-line data-[resizing=true]:border-s data-[resizing=true]:border-solid data-[resizing=true]:border-line";

export const detailsFavorite =
  "details-favorite-button details-hover:bg-surface-raised aria-pressed:bg-details-favorite aria-pressed:text-accent aria-pressed:control-active:bg-details-favorite aria-pressed:control-active:text-accent aria-pressed:details-hover:bg-details-favorite-hover aria-pressed:details-hover:text-accent-strong";

export const detailsBody =
  "flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-gutter-stable p-details-body in-[.details-drawer]:page-short:py-details-inset in-[.details-drawer]:page-mobile:px-details-inset in-[.book-details-panel]:px-details-section in-[.book-details-panel]:py-details-inset";

export const detailsCover =
  "details-cover relative mx-auto my-0 w-details-cover in-[.book-details-panel]:max-w-details-cover-docked-max";

export const detailsTitle = "constrained-user-content mt-details-inset text-center";
export const detailsHeading = "m-0 text-text-strong font-app-display text-section-title";
export const detailsAuthor = "m-0 mt-control-gap text-muted text-body-only";

export const detailsProgress =
  "details-progress-controls mt-details-progress-top flex min-h-dialog-panel items-center justify-center gap-menu-padding";

export const detailsActions = "details-actions mt-details-inset grid gap-control-gap";
export const detailsSecondaryActions =
  "details-actions__secondary mt-filter-token-gap grid grid-cols-2 gap-folder-action-gap details-narrow:grid-cols-1";

export const detailsMissing =
  "mt-details-inset grid details-missing-columns gap-x-dialog-copy gap-y-menu-item-block rounded-menu border-standard border-solid border-danger-border bg-danger-soft p-details-control-top text-muted";
export const detailsMissingActions = "col-span-full mt-menu-padding flex gap-control-gap-compact";

export const detailsDescription = "my-details-section wrap-anywhere";
export const detailsDescriptionHeading = "m-0 mb-control-gap text-body-only font-semibold";

export const detailsMetadata = "book-metadata m-0 mt-details-body grid";
export const detailsMetadataRow =
  "grid details-metadata-columns gap-details-edge border-0 border-t border-solid border-line py-details-progress-top last:border-b";
export const detailsMetadataLabel = "flex items-start gap-control-gap text-muted text-meta-only";
export const detailsMetadataValue =
  "m-0 grid min-w-0 gap-menu-padding text-end text-text text-meta-only";

export const detailsFooter =
  "grid grid-cols-1 gap-input-gap border-0 border-t border-solid border-line px-details-section py-details-progress-top";
