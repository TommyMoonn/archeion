import { useSyncExternalStore } from "react";

import { appPreferencesStore } from "../stores/appPreferencesStore";
import { AppearanceRuntime } from "./AppearanceRuntime";
import { ThemeCatalog } from "./ThemeCatalog";

export const themeCatalog = new ThemeCatalog();

export const appearanceRuntime = new AppearanceRuntime({
  catalog: themeCatalog,
  globalPreferences: appPreferencesStore,
});

export function useResolvedReaderTheme() {
  return useSyncExternalStore(
    appearanceRuntime.subscribe,
    appearanceRuntime.getReaderSnapshot,
    appearanceRuntime.getReaderSnapshot,
  );
}
