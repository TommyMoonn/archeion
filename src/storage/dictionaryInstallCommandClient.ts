import { invoke } from "@tauri-apps/api/core";

import type { InstalledDictionary } from "../types/dictionary";

export type DictionaryInstallCommandClient = Readonly<{
  installCatalog: (stagingToken: string) => Promise<InstalledDictionary>;
  importStarDict: (ifoPath: string) => Promise<InstalledDictionary>;
}>;

export const dictionaryInstallCommandClient: DictionaryInstallCommandClient = {
  installCatalog: (stagingToken) => invoke("install_catalog_dictionary", { stagingToken }),
  importStarDict: (ifoPath) => invoke("import_stardict_dictionary", { ifoPath }),
};
