import { invoke } from "@tauri-apps/api/core";

import type { DictionaryRegistrySnapshot } from "../types/dictionary";

export type DictionaryManagementCommandClient = Readonly<{
  list: () => Promise<DictionaryRegistrySnapshot>;
  rebuildIndex: (dictionaryId: string) => Promise<DictionaryRegistrySnapshot>;
  remove: (dictionaryId: string) => Promise<DictionaryRegistrySnapshot>;
  setEnabled: (dictionaryId: string, enabled: boolean) => Promise<DictionaryRegistrySnapshot>;
  setOrder: (dictionaryIds: readonly string[]) => Promise<DictionaryRegistrySnapshot>;
}>;

export const dictionaryManagementCommandClient: DictionaryManagementCommandClient = {
  list: () => invoke("list_installed_dictionaries"),
  rebuildIndex: (dictionaryId) => invoke("rebuild_dictionary_index", { dictionaryId }),
  remove: (dictionaryId) => invoke("remove_dictionary", { dictionaryId }),
  setEnabled: (dictionaryId, enabled) =>
    invoke("set_dictionary_enabled", { dictionaryId, enabled }),
  setOrder: (dictionaryIds) =>
    invoke("set_dictionary_order", { dictionaryIds: [...dictionaryIds] }),
};
