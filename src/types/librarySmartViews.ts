import type {
  LibraryBookSmartView,
  LibraryIntegritySmartView,
  LibraryLocation,
  LibrarySmartView,
  LibrarySmartViewPreferences,
} from "./library";

type LibrarySmartViewDefinitionBase<TId extends LibrarySmartView> = {
  description: string;
  id: TId;
  label: string;
  searchTerms: readonly string[];
};

export type LibraryBookSmartViewDefinition =
  LibrarySmartViewDefinitionBase<LibraryBookSmartView> & {
    kind: "books";
  };

export type LibraryIntegritySmartViewDefinition =
  LibrarySmartViewDefinitionBase<LibraryIntegritySmartView> & {
    kind: "integrity";
    location: Extract<LibraryLocation, { type: LibraryIntegritySmartView }>;
  };

export type LibrarySmartViewDefinition =
  LibraryBookSmartViewDefinition | LibraryIntegritySmartViewDefinition;

export const LIBRARY_BOOK_SMART_VIEW_DEFINITIONS = [
  {
    description: "Books you have not started reading.",
    id: "unread",
    kind: "books",
    label: "Unread",
    searchTerms: ["not started", "new books"],
  },
  {
    description: "Books with reading progress.",
    id: "in-progress",
    kind: "books",
    label: "In progress",
    searchTerms: ["continue", "continue reading", "started books"],
  },
  {
    description: "Books you have finished reading.",
    id: "completed",
    kind: "books",
    label: "Completed",
    searchTerms: ["finished", "read books"],
  },
  {
    description: "Books missing a title or author.",
    id: "needs-metadata",
    kind: "books",
    label: "Needs metadata",
    searchTerms: ["missing title", "missing author", "book details"],
  },
  {
    description: "Books without cover artwork.",
    id: "needs-cover",
    kind: "books",
    label: "Needs cover",
    searchTerms: ["missing cover", "cover art"],
  },
] as const satisfies readonly LibraryBookSmartViewDefinition[];

export const LIBRARY_INTEGRITY_SMART_VIEW_DEFINITIONS = [
  {
    description: "Review exact and probable duplicate EPUBs.",
    id: "duplicates",
    kind: "integrity",
    label: "Duplicates",
    location: { type: "duplicates" },
    searchTerms: ["duplicate books", "archive health", "archive integrity"],
  },
  {
    description: "Inspect Reader-relevant EPUB problems.",
    id: "epub-issues",
    kind: "integrity",
    label: "EPUB Issues",
    location: { type: "epub-issues" },
    searchTerms: ["epub diagnostics", "archive health", "archive integrity", "book issues"],
  },
] as const satisfies readonly LibraryIntegritySmartViewDefinition[];

export const LIBRARY_SMART_VIEW_DEFINITIONS: readonly LibrarySmartViewDefinition[] = [
  ...LIBRARY_BOOK_SMART_VIEW_DEFINITIONS,
  ...LIBRARY_INTEGRITY_SMART_VIEW_DEFINITIONS,
];

export const LIBRARY_SMART_VIEWS = LIBRARY_SMART_VIEW_DEFINITIONS.map(
  (definition) => definition.id,
) as LibrarySmartView[];

export const LIBRARY_BOOK_SMART_VIEWS = LIBRARY_BOOK_SMART_VIEW_DEFINITIONS.map(
  (definition) => definition.id,
) as LibraryBookSmartView[];

export const DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES: Readonly<LibrarySmartViewPreferences> =
  Object.freeze({
    enabled: false,
    visible: Object.freeze([...LIBRARY_BOOK_SMART_VIEWS]) as unknown as LibrarySmartView[],
  });

const supportedSmartViews = new Set<string>(LIBRARY_SMART_VIEWS);

export function isLibrarySmartView(value: unknown): value is LibrarySmartView {
  return typeof value === "string" && supportedSmartViews.has(value);
}

const supportedBookSmartViews = new Set<string>(LIBRARY_BOOK_SMART_VIEWS);

export function isLibraryBookSmartView(value: unknown): value is LibraryBookSmartView {
  return typeof value === "string" && supportedBookSmartViews.has(value);
}

export function librarySmartViewLabel(smartView: LibrarySmartView): string {
  return (
    LIBRARY_SMART_VIEW_DEFINITIONS.find((definition) => definition.id === smartView)?.label ??
    smartView
  );
}

export function isLibrarySmartViewVisible(
  preferences: LibrarySmartViewPreferences,
  smartView: LibrarySmartView,
): boolean {
  return preferences.enabled && preferences.visible.includes(smartView);
}

export function visibleLibrarySmartViewDefinitions(preferences: LibrarySmartViewPreferences) {
  if (!preferences.enabled) return [];
  const visible = new Set(preferences.visible);
  return LIBRARY_SMART_VIEW_DEFINITIONS.filter((definition) => visible.has(definition.id));
}

export function librarySmartViewForLocation(location: LibraryLocation): LibrarySmartView | null {
  if (location.type === "continue") return "in-progress";
  if (location.type === "smart-view") return location.smartView;
  if (location.type === "duplicates" || location.type === "epub-issues") return location.type;
  return null;
}

export function libraryLocationForSmartView(smartView: LibrarySmartView): LibraryLocation {
  const definition = LIBRARY_SMART_VIEW_DEFINITIONS.find(({ id }) => id === smartView);
  if (definition?.kind === "integrity") return definition.location;
  if (isLibraryBookSmartView(smartView)) {
    return smartView === "in-progress" ? { type: "continue" } : { type: "smart-view", smartView };
  }
  throw new Error(`Unknown Library Smart View: ${smartView}`);
}

export function normalizeVisibleLibraryLocation(
  location: LibraryLocation,
  preferences: LibrarySmartViewPreferences,
): LibraryLocation {
  const smartView = librarySmartViewForLocation(location);
  return smartView && !isLibrarySmartViewVisible(preferences, smartView)
    ? { type: "library" }
    : location;
}

export function normalizeVisibleLibraryHref(
  href: string,
  preferences: LibrarySmartViewPreferences,
): string {
  const url = new URL(href, "https://archeion.local");
  const view = url.searchParams.get("view");
  const requestedSmartView = url.searchParams.get("smartView");
  const smartView =
    view === "continue"
      ? "in-progress"
      : view === "smart" && isLibraryBookSmartView(requestedSmartView)
        ? requestedSmartView
        : view === "duplicates" || view === "epub-issues"
          ? view
          : undefined;
  if (!smartView || isLibrarySmartViewVisible(preferences, smartView)) return href;

  url.searchParams.set("view", "library");
  url.searchParams.delete("smartView");
  return `${url.pathname}${url.search}`;
}
