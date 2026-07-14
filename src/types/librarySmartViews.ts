import type { LibraryLocation, LibrarySmartView, LibrarySmartViewPreferences } from "./library";

export type LibrarySmartViewDefinition = {
  id: LibrarySmartView;
  label: string;
  searchTerms: readonly string[];
};

export const LIBRARY_SMART_VIEW_DEFINITIONS = [
  { id: "unread", label: "Unread", searchTerms: ["not started", "new books"] },
  {
    id: "in-progress",
    label: "In progress",
    searchTerms: ["continue", "continue reading", "started books"],
  },
  { id: "completed", label: "Completed", searchTerms: ["finished", "read books"] },
  {
    id: "needs-metadata",
    label: "Needs metadata",
    searchTerms: ["missing title", "missing author", "book details"],
  },
  {
    id: "needs-cover",
    label: "Needs cover",
    searchTerms: ["missing cover", "cover art"],
  },
] as const satisfies readonly LibrarySmartViewDefinition[];

export const LIBRARY_SMART_VIEWS = LIBRARY_SMART_VIEW_DEFINITIONS.map(
  (definition) => definition.id,
) as LibrarySmartView[];

export const DEFAULT_LIBRARY_SMART_VIEW_PREFERENCES: Readonly<LibrarySmartViewPreferences> =
  Object.freeze({
    enabled: false,
    visible: Object.freeze([...LIBRARY_SMART_VIEWS]) as unknown as LibrarySmartView[],
  });

const supportedSmartViews = new Set<string>(LIBRARY_SMART_VIEWS);

export function isLibrarySmartView(value: unknown): value is LibrarySmartView {
  return typeof value === "string" && supportedSmartViews.has(value);
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

export function normalizeVisibleLibraryLocation(
  location: LibraryLocation,
  preferences: LibrarySmartViewPreferences,
): LibraryLocation {
  const smartView =
    location.type === "continue"
      ? "in-progress"
      : location.type === "smart-view"
        ? location.smartView
        : undefined;
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
      : view === "smart" && isLibrarySmartView(requestedSmartView)
        ? requestedSmartView
        : undefined;
  if (!smartView || isLibrarySmartViewVisible(preferences, smartView)) return href;

  url.searchParams.set("view", "library");
  url.searchParams.delete("smartView");
  return `${url.pathname}${url.search}`;
}
