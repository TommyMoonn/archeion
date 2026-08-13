import { Channel, invoke } from "@tauri-apps/api/core";

import type { DictionaryDownloadOutcome, DictionaryDownloadProgress } from "../types/dictionary";

export type DictionaryDownloadCommandClient = Readonly<{
  download: (
    catalogId: string,
    onProgress: (progress: DictionaryDownloadProgress) => void,
  ) => Promise<DictionaryDownloadOutcome>;
  cancel: () => Promise<void>;
  cleanup: (stagingToken: string) => Promise<boolean>;
}>;

export const dictionaryDownloadCommandClient: DictionaryDownloadCommandClient = {
  download: (catalogId, onProgress) => {
    const channel = new Channel<DictionaryDownloadProgress>(onProgress);
    return invoke("download_dictionary_catalog_package", {
      catalogId,
      onProgress: channel,
    });
  },
  cancel: () => invoke("cancel_dictionary_download"),
  cleanup: (stagingToken) => invoke("cleanup_verified_dictionary_download", { stagingToken }),
};
