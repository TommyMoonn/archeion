import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useBlocker, type BlockerFunction } from "react-router-dom";

export type AsyncRouteIntentOwnership = {
  owns: () => boolean;
};

export type AsyncBlockedRouteAttempt = {
  id: symbol;
  locationKey: string;
};

type OwnedBlockedRouteAttempt = AsyncBlockedRouteAttempt & {
  ownership: AsyncRouteIntentOwnership;
  reported: boolean;
};

type RouteSettlement = {
  promise: Promise<boolean>;
  sessionKey: string | undefined;
};

type AsyncRouteLeaveGuardOptions = {
  onBlockedNavigationIntent?: (attempt: AsyncBlockedRouteAttempt) => void;
  onBlockedNavigationSettled?: (attempt: AsyncBlockedRouteAttempt, settled: boolean) => void;
  onNavigationIntent: () => AsyncRouteIntentOwnership;
  sessionKey: string | undefined;
  settle: () => Promise<boolean>;
};

export function useAsyncRouteLeaveGuard({
  onBlockedNavigationIntent,
  onBlockedNavigationSettled,
  onNavigationIntent,
  sessionKey,
  settle,
}: AsyncRouteLeaveGuardOptions): void {
  const intentRef = useRef(onNavigationIntent);
  const blockedIntentRef = useRef(onBlockedNavigationIntent);
  const blockedSettlementRef = useRef(onBlockedNavigationSettled);
  const settleRef = useRef(settle);
  const sessionKeyRef = useRef(sessionKey);
  const settlementOwnerRef = useRef(0);
  const attemptsRef = useRef(new Map<string, OwnedBlockedRouteAttempt>());
  const routeSettlementRef = useRef<RouteSettlement | null>(null);

  useLayoutEffect(() => {
    intentRef.current = onNavigationIntent;
    blockedIntentRef.current = onBlockedNavigationIntent;
    blockedSettlementRef.current = onBlockedNavigationSettled;
    settleRef.current = settle;
    sessionKeyRef.current = sessionKey;
  }, [
    onBlockedNavigationIntent,
    onBlockedNavigationSettled,
    onNavigationIntent,
    sessionKey,
    settle,
  ]);

  const reportSettlement = useCallback((attempt: OwnedBlockedRouteAttempt, settled: boolean) => {
    if (attempt.reported) return;
    attempt.reported = true;
    blockedSettlementRef.current?.({ id: attempt.id, locationKey: attempt.locationKey }, settled);
  }, []);

  const removeActiveAttempt = useCallback((attempt: OwnedBlockedRouteAttempt) => {
    if (attemptsRef.current.get(attempt.locationKey) !== attempt) return false;
    attemptsRef.current.delete(attempt.locationKey);
    return true;
  }, []);

  const acquireRouteSettlement = useCallback(() => {
    const active = routeSettlementRef.current;
    const currentSessionKey = sessionKeyRef.current;
    if (active && active.sessionKey === currentSessionKey) return active;
    const settlement: RouteSettlement = {
      promise: settleRef.current().catch(() => false),
      sessionKey: currentSessionKey,
    };
    routeSettlementRef.current = settlement;
    return settlement;
  }, []);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => {
      const changesRoute =
        currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search;
      if (changesRoute) {
        settlementOwnerRef.current += 1;
        for (const previous of [...attemptsRef.current.values()]) {
          reportSettlement(previous, false);
          removeActiveAttempt(previous);
        }
        const attempt: OwnedBlockedRouteAttempt = {
          id: Symbol("blocked-route-attempt"),
          locationKey: nextLocation.key,
          ownership: intentRef.current(),
          reported: false,
        };
        attemptsRef.current.set(nextLocation.key, attempt);
        blockedIntentRef.current?.({ id: attempt.id, locationKey: attempt.locationKey });
      }
      return changesRoute;
    },
    [removeActiveAttempt, reportSettlement],
  );
  const blocker = useBlocker(shouldBlock);
  const blockerRef = useRef(blocker);

  useLayoutEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);

  const blockedLocationKey = blocker.state === "blocked" ? blocker.location.key : undefined;
  useEffect(() => {
    if (blocker.state !== "blocked" || !blockedLocationKey) return;

    const attempt = attemptsRef.current.get(blockedLocationKey);
    if (!attempt) return;
    const owner = ++settlementOwnerRef.current;
    const ownerSessionKey = sessionKeyRef.current;
    const ownerLocationKey = blockedLocationKey;
    const routeSettlement = acquireRouteSettlement();
    let cancelled = false;

    void routeSettlement.promise.then((settled) => {
      if (
        cancelled ||
        settlementOwnerRef.current !== owner ||
        sessionKeyRef.current !== ownerSessionKey
      ) {
        return;
      }

      const activeAttempt = attemptsRef.current.get(ownerLocationKey);
      if (activeAttempt !== attempt) return;

      const currentBlocker = blockerRef.current;
      if (currentBlocker.state !== "blocked" || currentBlocker.location.key !== ownerLocationKey) {
        return;
      }

      const accepted = settled && attempt.ownership.owns();
      if (accepted) {
        currentBlocker.proceed();
      } else {
        currentBlocker.reset();
      }
      removeActiveAttempt(attempt);
      if (routeSettlementRef.current === routeSettlement) routeSettlementRef.current = null;
      reportSettlement(attempt, accepted);
    });

    return () => {
      cancelled = true;
    };
  }, [
    acquireRouteSettlement,
    blockedLocationKey,
    blocker,
    blocker.state,
    removeActiveAttempt,
    reportSettlement,
  ]);

  useEffect(
    () => () => {
      settlementOwnerRef.current += 1;
      routeSettlementRef.current = null;
      for (const attempt of attemptsRef.current.values()) reportSettlement(attempt, false);
      attemptsRef.current.clear();
    },
    [reportSettlement],
  );
}
