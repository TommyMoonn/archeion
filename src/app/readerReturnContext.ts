export type ReaderReturnContext = {
  archiveId: string;
  href: string;
  focusBookId?: string;
  label?: string;
  query?: string;
  scrollTop?: number;
  seriesQuery?: string;
};

export type ReaderRouteState = {
  readerReturnContext?: unknown;
};

export type LibraryRestoreState = {
  libraryRestoreContext?: unknown;
};

const MAX_TRANSIENT_QUERY_LENGTH = 500;

function optionalString(value: unknown, maximumLength = MAX_TRANSIENT_QUERY_LENGTH) {
  return typeof value === "string" && value.length <= maximumLength ? value : undefined;
}

function safeLibraryHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value, "https://archeion.local");
    if (parsed.origin !== "https://archeion.local" || parsed.pathname !== "/") return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function normalizeReaderReturnContext(
  value: unknown,
  activeArchiveId: string | null,
): ReaderReturnContext | null {
  if (!activeArchiveId || !value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const href = safeLibraryHref(candidate.href);
  if (candidate.archiveId !== activeArchiveId || !href) return null;
  const scrollTop =
    typeof candidate.scrollTop === "number" &&
    Number.isFinite(candidate.scrollTop) &&
    candidate.scrollTop >= 0
      ? candidate.scrollTop
      : undefined;
  return {
    archiveId: activeArchiveId,
    href,
    focusBookId: optionalString(candidate.focusBookId, 200),
    label: optionalString(candidate.label, 100),
    query: optionalString(candidate.query),
    scrollTop,
    seriesQuery: optionalString(candidate.seriesQuery),
  };
}

export function readerReturnContextFromState(
  state: unknown,
  activeArchiveId: string | null,
): ReaderReturnContext | null {
  const routeState = state && typeof state === "object" ? (state as ReaderRouteState) : null;
  return normalizeReaderReturnContext(routeState?.readerReturnContext, activeArchiveId);
}

export function libraryRestoreContextFromState(
  state: unknown,
  activeArchiveId: string | null,
): ReaderReturnContext | null {
  const routeState = state && typeof state === "object" ? (state as LibraryRestoreState) : null;
  return normalizeReaderReturnContext(routeState?.libraryRestoreContext, activeArchiveId);
}

export function createReaderReturnContext(input: ReaderReturnContext): ReaderReturnContext {
  return {
    ...input,
    href: safeLibraryHref(input.href) ?? "/",
    scrollTop: Math.max(0, input.scrollTop ?? 0),
  };
}

export function readerReturnAccessibleLabel(context: ReaderReturnContext | null) {
  return context?.label ? `Back to ${context.label}` : "Back to Library";
}

export function readerReturnNavigation(context: ReaderReturnContext | null) {
  return context
    ? {
        href: context.href,
        state: { libraryRestoreContext: context } satisfies LibraryRestoreState,
      }
    : { href: "/", state: undefined };
}
