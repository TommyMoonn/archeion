import { createContext, useContext, useEffect } from "react";

import { retireCoverUrlScope } from "./coverUrlCache";

const DEFAULT_COVER_URL_CACHE_SCOPE = "unscoped";

export const CoverUrlCacheScopeContext = createContext(DEFAULT_COVER_URL_CACHE_SCOPE);

export function useCoverUrlCacheLifetime(scope: string | undefined): void {
  useEffect(() => {
    if (scope) return () => retireCoverUrlScope(scope);
  }, [scope]);
}

export function useCoverUrlCacheScope(): string {
  return useContext(CoverUrlCacheScopeContext);
}
