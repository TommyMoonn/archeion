import { invoke } from "@tauri-apps/api/core";

import type { DictionaryCatalogSnapshot } from "../types/dictionary";

export type DictionaryCatalogCommandClient = Readonly<{
  loadCached: () => Promise<DictionaryCatalogSnapshot | null>;
  refresh: () => Promise<DictionaryCatalogSnapshot>;
  cancelRefresh: () => Promise<void>;
}>;

export const dictionaryCatalogCommandClient: DictionaryCatalogCommandClient = {
  loadCached: () => invoke("load_cached_dictionary_catalog"),
  refresh: () => invoke("refresh_dictionary_catalog"),
  cancelRefresh: () => invoke("cancel_dictionary_catalog_refresh"),
};
