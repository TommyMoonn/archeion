import { useSyncExternalStore } from "react";

import { appPreferencesStore } from "../stores/appPreferencesStore";
import { AppearanceRuntime } from "./AppearanceRuntime";

export const appearanceRuntime = new AppearanceRuntime({
  globalPreferences: appPreferencesStore,
});

export function useResolvedReaderTheme() {
  return useSyncExternalStore(
    appearanceRuntime.subscribe,
    appearanceRuntime.getReaderSnapshot,
    appearanceRuntime.getReaderSnapshot,
  );
}
