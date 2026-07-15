import { useSyncExternalStore } from "react";

import { appPreferencesStore } from "../stores/appPreferencesStore";
import { AppearanceRuntime } from "./AppearanceRuntime";
import { ArchiveThemeCatalog } from "./ArchiveThemeCatalog";

export const archiveThemeCatalog = new ArchiveThemeCatalog();

export const appearanceRuntime = new AppearanceRuntime({
  catalog: archiveThemeCatalog,
  globalPreferences: appPreferencesStore,
});

export function useResolvedReaderTheme() {
  return useSyncExternalStore(
    appearanceRuntime.subscribe,
    appearanceRuntime.getReaderSnapshot,
    appearanceRuntime.getReaderSnapshot,
  );
}
