import { useMemo } from "react";

import { resolveBuiltInAppTheme, resolveTheme } from "../../themes/resolveTheme";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";

/** Catalog entries are immutable snapshots; replacement invalidates the presentation memo. */
export function useThemePreview(entry: ThemeCatalogEntry | null) {
  return useMemo(() => {
    if (!entry?.applicable || !entry.capabilities.application) return null;
    return entry.origin === "builtin"
      ? entry.appBase
        ? resolveBuiltInAppTheme(entry.appBase)
        : null
      : resolveTheme(entry.manifest).app;
  }, [entry]);
}
