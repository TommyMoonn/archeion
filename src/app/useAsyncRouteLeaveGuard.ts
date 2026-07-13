import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useBlocker, type BlockerFunction } from "react-router-dom";

type AsyncRouteLeaveGuardOptions = {
  onNavigationIntent: () => void;
  sessionKey: string | undefined;
  settle: () => Promise<boolean>;
};

export function useAsyncRouteLeaveGuard({
  onNavigationIntent,
  sessionKey,
  settle,
}: AsyncRouteLeaveGuardOptions): void {
  const intentRef = useRef(onNavigationIntent);
  const settleRef = useRef(settle);
  const sessionKeyRef = useRef(sessionKey);
  const settlementOwnerRef = useRef(0);

  useLayoutEffect(() => {
    intentRef.current = onNavigationIntent;
    settleRef.current = settle;
    sessionKeyRef.current = sessionKey;
  }, [onNavigationIntent, sessionKey, settle]);

  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    const changesRoute =
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search;
    if (changesRoute) intentRef.current();
    return changesRoute;
  }, []);
  const blocker = useBlocker(shouldBlock);
  const blockerRef = useRef(blocker);

  useLayoutEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);

  const blockedLocationKey = blocker.state === "blocked" ? blocker.location.key : undefined;
  useEffect(() => {
    if (blocker.state !== "blocked" || !blockedLocationKey) return;

    const owner = ++settlementOwnerRef.current;
    const ownerSessionKey = sessionKeyRef.current;
    const ownerLocationKey = blockedLocationKey;
    let cancelled = false;

    void settleRef
      .current()
      .catch(() => false)
      .then((settled) => {
        if (
          cancelled ||
          settlementOwnerRef.current !== owner ||
          sessionKeyRef.current !== ownerSessionKey
        ) {
          return;
        }

        const currentBlocker = blockerRef.current;
        if (
          currentBlocker.state !== "blocked" ||
          currentBlocker.location.key !== ownerLocationKey
        ) {
          return;
        }

        if (settled) {
          currentBlocker.proceed();
        } else {
          currentBlocker.reset();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [blockedLocationKey, blocker.state]);

  useEffect(
    () => () => {
      settlementOwnerRef.current += 1;
    },
    [],
  );
}
