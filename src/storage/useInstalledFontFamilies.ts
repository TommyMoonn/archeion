import { useEffect, useState } from "react";

import { installedFontCatalog, type InstalledFontCatalog } from "./installedFontCatalog";

const EMPTY_FAMILIES: readonly string[] = Object.freeze([]);

/** A React projection of the catalog's cached promise, not a second catalog. */
export function useInstalledFontFamilies(enabled: boolean, catalog = installedFontCatalog) {
  const [snapshot, setSnapshot] = useState<{
    catalog: InstalledFontCatalog;
    families: readonly string[];
  } | null>(null);
  const families = snapshot?.catalog === catalog ? snapshot.families : null;

  useEffect(() => {
    if (!enabled || families !== null) return;
    let active = true;
    void catalog.load().then((loaded) => {
      if (active) setSnapshot({ catalog, families: loaded });
    });
    return () => {
      active = false;
    };
  }, [catalog, enabled, families]);

  return { families: families ?? EMPTY_FAMILIES, loading: families === null };
}
