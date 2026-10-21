import { useEffect, useState } from "react";

export const UTILITY_WINDOW_LOAD_TIMEOUT_MS = 10_000;
export type UtilityWindowLoadState = "loading" | "ready" | "error";

// Observes a window-local load without replacing or retrying its shared owner.
// Reload starts a new document/store lifecycle when that owner's promise is stuck.
export function useUtilityWindowLoadState(load?: () => Promise<void>): UtilityWindowLoadState {
  const [state, setState] = useState<UtilityWindowLoadState>("loading");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      active = false;
      setState("error");
    }, UTILITY_WINDOW_LOAD_TIMEOUT_MS);
    if (load) {
      void load().then(
        () => {
          clearTimeout(timer);
          if (active) setState("ready");
        },
        () => {
          clearTimeout(timer);
          if (active) setState("error");
        },
      );
    }
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load]);
  return state;
}
