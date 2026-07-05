import { isTauri } from "@tauri-apps/api/core";

import { IndexedDbLibraryStorage } from "./IndexedDbLibraryStorage";
import { TauriVaultLibraryStorage } from "./TauriVaultLibraryStorage";

export const libraryStorage = isTauri()
  ? new TauriVaultLibraryStorage()
  : new IndexedDbLibraryStorage();
