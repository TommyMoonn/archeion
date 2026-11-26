// Shared Library, Folder Browser, Series and integrity collection geometry.
export const collectionHeader = {
  root: "library-header grid collection-header-columns items-end gap-collection-header-gap max-w-collection-workspace mx-auto @container/collection-header collection-viewport-stacked:collection-single-column",
  title: "m-0 mt-collection-title-top font-app-display text-display-compact text-text-strong",
  eyebrow:
    "eyebrow m-0 text-muted text-caption-size font-semibold tracking-settings-eyebrow uppercase",
  actions: String.raw`library-header__actions grid items-center gap-control-gap w-collection-actions [&_.input-shell]:min-h-control-standard [&>.button]:min-h-control-standard collection-viewport-stacked:row-start-2 collection-viewport-stacked:w-full collection-header-stacked:row-start-2 collection-header-stacked:w-full collection-header-narrow:[&_.button]:w-control-prominent collection-header-narrow:[&_.button]:p-0 collection-header-narrow:[&_.button\_\_label]:sr-only`,
  actionsFull: "collection-actions-full collection-header-narrow:collection-actions-full-narrow",
  actionsPrimary:
    "library-header__actions--primary-only collection-actions-primary collection-header-narrow:collection-actions-primary-narrow",
  actionsSearch:
    "library-header__actions--search-only collection-actions-search collection-header-narrow:grid-cols-1",
  divider: "library-header__action-divider w-px h-dialog-panel bg-line",
  search:
    "library-search relative w-full [&_.input-shell]:w-full [&_.input-shell]:pe-control-prominent [&_input::-webkit-search-cancel-button]:hidden",
  clear:
    "library-search__clear absolute top-1/2 end-folder-action-gap size-collection-search-clear -translate-y-1/2 control-enabled:cursor-pointer",
  controls:
    "library-controls col-span-full flex items-center justify-between min-h-collection-controls border-0 border-b border-solid border-line collection-header-narrow:items-start collection-header-narrow:flex-wrap collection-header-narrow:gap-field-standard-inline",
  display:
    "library-controls__display flex items-center gap-field-standard-inline collection-header-narrow:max-w-full collection-header-narrow:ms-auto",
  count:
    "library-result-count min-w-collection-count text-muted text-meta-only tabular-nums text-start whitespace-nowrap",
} as const;

// Non-book destinations share the same density, height, and empty-state alignment.
export const collectionContent = String.raw`collection-content grid content-start min-h-collection-workspace-height max-w-collection-workspace mx-auto pt-collection-initial-top page-short:min-h-collection-workspace-height-short page-narrow:min-h-collection-workspace-height-narrow data-[surface-state=results]:gap-y-collection-content data-[surface-state=results]:pt-collection-content [&:is([data-surface-state=empty],[data-surface-state=filter-empty],[data-surface-state=loading],[data-surface-state=search-empty])]:content-center [&:is([data-surface-state=empty],[data-surface-state=filter-empty],[data-surface-state=loading],[data-surface-state=search-empty])]:py-collection-empty-inset [&>.empty-state]:justify-self-center [&>.collection-content\_\_loading]:justify-self-center [&>.empty-state]:m-0 [&>.collection-content\_\_loading]:m-0`;
