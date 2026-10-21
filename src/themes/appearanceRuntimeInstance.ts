import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";

import { appPreferencesStore } from "../stores/appPreferencesStore";
import { AppearanceRuntime } from "./AppearanceRuntime";
import { ThemeCatalog } from "./ThemeCatalog";
import { publishAppearancePresentation } from "./appearancePresentation";

export const themeCatalog = new ThemeCatalog();

export const appearanceRuntime = new AppearanceRuntime({
  catalog: themeCatalog,
  globalPreferences: appPreferencesStore,
  preparePresentation: isTauri() ? publishAppearancePresentation : undefined,
});

export function useResolvedReaderTheme() {
  return useSyncExternalStore(
    appearanceRuntime.subscribe,
    appearanceRuntime.getReaderSnapshot,
    appearanceRuntime.getReaderSnapshot,
  );
}
