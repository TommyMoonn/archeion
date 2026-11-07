import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { SurfacePresenceContext } from "./modalPresenceContext";

/** Place outside a conditional modal mount. Replacements and owner teardown retire immediately. */
export function SurfacePresence({ children }: { children: ReactElement | null }) {
  const owners = useRef(0);
  const register = useCallback(() => {
    owners.current += 1;
    return () => {
      owners.current -= 1;
    };
  }, []);
  const [retained, setRetained] = useState(children);
  if (children && children !== retained) setRetained(children);
  const current = children ?? retained;
  const complete = useCallback(() => {
    setRetained((previous) => (previous === current ? null : previous));
  }, [current]);
  const presence = useMemo(
    () => ({ present: children !== null, complete, register }),
    [children, complete, register],
  );

  useLayoutEffect(() => {
    // A suspended surface may be dismissed before it has mounted a native owner.
    if (!children && owners.current === 0) complete();
  }, [children, complete]);

  return current ? (
    <SurfacePresenceContext value={presence}>{current}</SurfacePresenceContext>
  ) : null;
}
