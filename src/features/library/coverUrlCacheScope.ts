import { createContext, useContext } from "react";

const DEFAULT_COVER_URL_CACHE_SCOPE = "unscoped";

export const CoverUrlCacheScopeContext = createContext(DEFAULT_COVER_URL_CACHE_SCOPE);

export function useCoverUrlCacheScope(): string {
  return useContext(CoverUrlCacheScopeContext);
}
