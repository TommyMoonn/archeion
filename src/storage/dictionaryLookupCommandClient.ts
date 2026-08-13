import { invoke } from "@tauri-apps/api/core";

import type { DictionaryLookupResponse } from "../types/dictionary";

export type DictionaryLookupCommandClient = Readonly<{
  lookup: (term: string) => Promise<DictionaryLookupResponse>;
}>;

export const dictionaryLookupCommandClient: DictionaryLookupCommandClient = {
  lookup: (term) => invoke("lookup_dictionary_term", { term }),
};
