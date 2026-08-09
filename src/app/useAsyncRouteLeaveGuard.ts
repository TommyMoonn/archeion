import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useBlocker, type BlockerFunction } from "react-router-dom";

export type AsyncRouteIntentOwnership = {
  owns: () => boolean;
  settled?: boolean;
};

export type AsyncRouteOwnershipToken = object;

export type AsyncBlockedRouteAttempt = {
  id: symbol;
  locationKey: string;
};

type OwnedBlockedRouteAttempt = AsyncBlockedRouteAttempt & {
  ownership: AsyncRouteIntentOwnership;
  ownershipToken: AsyncRouteOwnershipToken;
  reported: boolean;
};

type RouteSettlement = {
  ownershipToken: AsyncRouteOwnershipToken;
  promise: Promise<boolean>;
};

type AsyncRouteLeaveGuardOptions = {
  onBlockedNavigationIntent?: (attempt: AsyncBlockedRouteAttempt) => void;
  onBlockedNavigationSettled?: (attempt: AsyncBlockedRouteAttempt, settled: boolean) => void;
  onNavigationIntent: () => AsyncRouteIntentOwnership;
  ownershipToken: AsyncRouteOwnershipToken;
  settle: () => Promise<boolean>;
};

export function useAsyncRouteLeaveGuard({
  onBlockedNavigationIntent,
  onBlockedNavigationSettled,
  onNavigationIntent,
  ownershipToken,
  settle,
}: AsyncRouteLeaveGuardOptions): void {
  const intentRef = useRef(onNavigationIntent);
  const blockedIntentRef = useRef(onBlockedNavigationIntent);
  const blockedSettlementRef = useRef(onBlockedNavigationSettled);
  const settleRef = useRef(settle);
  const ownershipTokenRef = useRef(ownershipToken);
  const settlementOwnerRef = useRef(0);
  const attemptsRef = useRef(new Map<symbol, OwnedBlockedRouteAttempt>());
  const currentAttemptRef = useRef<OwnedBlockedRouteAttempt | null>(null);
  const routeSettlementRef = useRef<RouteSettlement | null>(null);

  useLayoutEffect(() => {
    intentRef.current = onNavigationIntent;
    blockedIntentRef.current = onBlockedNavigationIntent;
    blockedSettlementRef.current = onBlockedNavigationSettled;
    settleRef.current = settle;
  }, [onBlockedNavigationIntent, onBlockedNavigationSettled, onNavigationIntent, settle]);

  const reportSettlement = useCallback((attempt: OwnedBlockedRouteAttempt, settled: boolean) => {
    if (attempt.reported) return;
    attempt.reported = true;
    blockedSettlementRef.current?.({ id: attempt.id, locationKey: attempt.locationKey }, settled);
  }, []);

  const removeActiveAttempt = useCallback((attempt: OwnedBlockedRouteAttempt) => {
    if (attemptsRef.current.get(attempt.id) !== attempt) return false;
    attemptsRef.current.delete(attempt.id);
    if (currentAttemptRef.current === attempt) currentAttemptRef.current = null;
    return true;
  }, []);

  const acquireRouteSettlement = useCallback(() => {
    const active = routeSettlementRef.current;
    const currentOwnershipToken = ownershipTokenRef.current;
    if (active && active.ownershipToken === currentOwnershipToken) return active;
    const settlement: RouteSettlement = {
      ownershipToken: currentOwnershipToken,
      promise: settleRef.current().catch(() => false),
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
        const ownership = intentRef.current();
        if (ownership.settled && ownership.owns()) return false;
        settlementOwnerRef.current += 1;
        for (const previous of [...attemptsRef.current.values()]) {
          reportSettlement(previous, false);
          removeActiveAttempt(previous);
        }
        const attempt: OwnedBlockedRouteAttempt = {
          id: Symbol("blocked-route-attempt"),
          locationKey: nextLocation.key,
          ownership,
          ownershipToken: ownershipTokenRef.current,
          reported: false,
        };
        attemptsRef.current.set(attempt.id, attempt);
        currentAttemptRef.current = attempt;
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

  const retireBlockedAttempt = useCallback(
    (attempt: OwnedBlockedRouteAttempt) => {
      const currentBlocker = blockerRef.current;
      const resetsCurrentBlocker =
        currentAttemptRef.current === attempt &&
        currentBlocker.state === "blocked" &&
        currentBlocker.location.key === attempt.locationKey;
      removeActiveAttempt(attempt);
      reportSettlement(attempt, false);
      if (resetsCurrentBlocker) currentBlocker.reset();
    },
    [removeActiveAttempt, reportSettlement],
  );

  useLayoutEffect(() => {
    if (ownershipTokenRef.current === ownershipToken) return;
    ownershipTokenRef.current = ownershipToken;
    settlementOwnerRef.current += 1;
    routeSettlementRef.current = null;
    for (const attempt of [...attemptsRef.current.values()]) {
      if (attempt.ownershipToken !== ownershipToken) retireBlockedAttempt(attempt);
    }
  }, [ownershipToken, retireBlockedAttempt]);

  const blockedLocationKey = blocker.state === "blocked" ? blocker.location.key : undefined;
  useEffect(() => {
    if (blocker.state !== "blocked" || !blockedLocationKey) return;

    const attempt = currentAttemptRef.current;
    if (!attempt || attempt.locationKey !== blockedLocationKey) return;
    const owner = ++settlementOwnerRef.current;
    const routeSettlement = acquireRouteSettlement();
    let cancelled = false;

    void routeSettlement.promise.then((settled) => {
      if (cancelled) return;
      if (
        settlementOwnerRef.current !== owner ||
        ownershipTokenRef.current !== attempt.ownershipToken
      ) {
        retireBlockedAttempt(attempt);
        return;
      }

      const activeAttempt = attemptsRef.current.get(attempt.id);
      if (activeAttempt !== attempt) return;

      const currentBlocker = blockerRef.current;
      if (
        currentAttemptRef.current !== attempt ||
        currentBlocker.state !== "blocked" ||
        currentBlocker.location.key !== attempt.locationKey
      ) {
        retireBlockedAttempt(attempt);
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
    retireBlockedAttempt,
  ]);

  useEffect(
    () => () => {
      settlementOwnerRef.current += 1;
      routeSettlementRef.current = null;
      for (const attempt of attemptsRef.current.values()) reportSettlement(attempt, false);
      attemptsRef.current.clear();
      currentAttemptRef.current = null;
    },
    [reportSettlement],
  );
}
