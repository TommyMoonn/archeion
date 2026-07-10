import { appPreferencesStore, type AppPreferencesStore } from "../stores/appPreferencesStore";
import { archiveStore, type ArchiveStore } from "../stores/archiveStore";
import type { RememberedNavigationState } from "../types/appSettings";

type RouteLocation = {
  pathname: string;
};

type RouterState = {
  location: RouteLocation;
};

type NavigationRouter = {
  state: RouterState;
  subscribe: (listener: (state: RouterState) => void) => () => void;
};

export function canonicalReaderRoute(bookId: string): string {
  return `/reader/${encodeURIComponent(bookId)}`;
}

export function rememberedNavigationForLocation(
  location: RouteLocation,
  archiveId: string | null,
): RememberedNavigationState | null {
  if (!archiveId) {
    return null;
  }

  const match = /^\/reader\/([^/]+)$/.exec(location.pathname);
  if (!match) {
    return null;
  }

  let bookId: string;
  try {
    bookId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  if (!bookId) {
    return null;
  }

  return {
    archiveId,
    bookId,
    lastRoute: canonicalReaderRoute(bookId),
  };
}

function navigationStatesEqual(
  left: RememberedNavigationState | null,
  right: RememberedNavigationState | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.archiveId === right.archiveId &&
      left.bookId === right.bookId &&
      left.lastRoute === right.lastRoute)
  );
}

export function startNavigationStateTracking(
  routerInstance: NavigationRouter,
  preferencesStore: AppPreferencesStore = appPreferencesStore,
  archives: ArchiveStore = archiveStore,
): () => void {
  let stopped = false;

  const persistLocation = (location: RouteLocation) => {
    const archive = archives.getSnapshot();
    const next = rememberedNavigationForLocation(
      location,
      archive.status === "ready" ? archive.archive.id : null,
    );
    if (navigationStatesEqual(preferencesStore.getSnapshot().navigation, next)) {
      return;
    }

    void preferencesStore.update({ navigation: next }).catch(() => undefined);
  };

  persistLocation(routerInstance.state.location);
  const unsubscribe = routerInstance.subscribe((state) => {
    if (!stopped) {
      persistLocation(state.location);
    }
  });

  return () => {
    stopped = true;
    unsubscribe();
  };
}
