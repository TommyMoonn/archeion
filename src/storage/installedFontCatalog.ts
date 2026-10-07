import { invoke, isTauri } from "@tauri-apps/api/core";

export type InstalledFontCatalogProvider = () => Promise<readonly string[]>;

export type InstalledFontCatalog = Readonly<{
  load: () => Promise<readonly string[]>;
}>;

async function loadNativeFamilies(): Promise<readonly string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>("list_installed_font_families");
}

/** An injected catalog represents one session. There is intentionally no refresh. */
export function createInstalledFontCatalog(
  provider: InstalledFontCatalogProvider = loadNativeFamilies,
): InstalledFontCatalog {
  let pending: Promise<readonly string[]> | undefined;
  return {
    load() {
      pending ??= Promise.resolve()
        .then(provider)
        .then((families) => Object.freeze([...families]))
        .catch(() => Object.freeze([] as string[]));
      return pending;
    },
  };
}

// All font roles in this window share this service. The native cache also shares
// the enumeration across windows for the lifetime of the application process.
export const installedFontCatalog = createInstalledFontCatalog();
