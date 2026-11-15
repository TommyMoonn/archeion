import { usePluginData } from "@docusaurus/useGlobalData";
import type { DocsSearchData } from "./types";

export function useDocsSearchData() {
  // This plugin's build-time typed producer is the sole owner of this payload.
  return usePluginData("archeion-docs-search") as DocsSearchData;
}
