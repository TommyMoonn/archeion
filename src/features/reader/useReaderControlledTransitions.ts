import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  useAsyncRouteLeaveGuard,
  type AsyncBlockedRouteAttempt,
  type AsyncRouteIntentOwnership,
} from "../../app/useAsyncRouteLeaveGuard";
import { archiveStore } from "../../stores/archiveStore";
import { settleAndRetireReaderSession } from "./readerNavigation";
import type { ReaderSessionIdentity } from "./readerSession";

export type ReaderTransitionOwner = Readonly<{
  archiveId: string | null;
  readerIdentity: ReaderSessionIdentity | null;
}>;

export type ReaderTransitionRequest = {
  id: number;
  owner: ReaderTransitionOwner;
};

type ReaderControlledTransitionOptions = {
  archiveId: string | null;
  onTransitionIntent: () => void;
  readerIdentity: ReaderSessionIdentity | null;
  retired?: boolean;
  retire: () => void | Promise<void>;
  settle: () => Promise<boolean>;
};

export const READER_EXIT_DEADLINE_MS = 15_000;
export type ReaderExitFailure = "rejected" | "timeout";
type ReaderExitAttempt = { request: ReaderTransitionRequest; failure: ReaderExitFailure | null };

type ControlledExitOwnership = {
  actionInProgress: boolean;
  blockedAttemptId?: symbol;
  owner: ReaderTransitionOwner;
  promise: Promise<boolean>;
  request: ReaderTransitionRequest;
  resolve: (result: boolean) => void;
  settlementComplete: boolean;
};

type ReaderLeaveSettlementOwnership = {
  owner: ReaderTransitionOwner;
  promise: Promise<boolean>;
};

export function useReaderControlledTransitions({
  archiveId,
  onTransitionIntent,
  readerIdentity,
  retired = false,
  retire,
  settle,
}: ReaderControlledTransitionOptions) {
  const transitionOwner = useMemo<ReaderTransitionOwner>(
    () => Object.freeze({ archiveId, readerIdentity }),
    [archiveId, readerIdentity],
  );
  const mountedRef = useRef(true);
  const transitionOwnerRef = useRef(transitionOwner);
  const intentRef = useRef(onTransitionIntent);
  const settleRef = useRef(settle);
  const retireRef = useRef(retire);
  const requestSequenceRef = useRef(0);
  const leaveRequestSequenceRef = useRef(0);
  const controlledExitRef = useRef<ControlledExitOwnership | null>(null);
  const [exitAttempt, setExitAttempt] = useState<ReaderExitAttempt | null>(null);
  const exitRequestRef = useRef<ReaderTransitionRequest | null>(null);
  const blockedExitRef = useRef<{ id: symbol; request: ReaderTransitionRequest } | null>(null);
  const [pendingExit, setPendingExit] = useState<ReaderTransitionRequest | null>(null);
  const leaveSettlementRef = useRef<ReaderLeaveSettlementOwnership | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<ReaderLeaveSettlementOwnership | null>(
    null,
  );

  useLayoutEffect(() => {
    if (transitionOwnerRef.current !== transitionOwner) {
      const ownedExit = controlledExitRef.current;
      controlledExitRef.current = null;
      ownedExit?.resolve(false);
      leaveSettlementRef.current = null;
    }
    transitionOwnerRef.current = transitionOwner;
    intentRef.current = onTransitionIntent;
    settleRef.current = settle;
    retireRef.current = retire;
  }, [onTransitionIntent, retire, settle, transitionOwner]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      controlledExitRef.current?.resolve(false);
      controlledExitRef.current = null;
      leaveSettlementRef.current = null;
    };
  }, []);

  const beginTransition = useCallback((): ReaderTransitionRequest => {
    intentRef.current();
    setExitAttempt(null);
    exitRequestRef.current = null;
    return {
      id: ++requestSequenceRef.current,
      owner: transitionOwnerRef.current,
    };
  }, []);

  const ownsTransition = useCallback(
    (request: ReaderTransitionRequest) =>
      mountedRef.current &&
      requestSequenceRef.current === request.id &&
      transitionOwnerRef.current === request.owner,
    [],
  );

  const beginLeave = useCallback(() => {
    const request = beginTransition();
    exitRequestRef.current = request;
    setExitAttempt({ request, failure: null });
    return request;
  }, [beginTransition]);

  const failExit = useCallback(
    (request: ReaderTransitionRequest, failure: ReaderExitFailure) => {
      if (!ownsTransition(request)) return;
      setExitAttempt((current) => (current?.request === request ? { request, failure } : current));
    },
    [ownsTransition],
  );

  // A navigation/blocker acknowledgement is not a destination presentation commit.
  // Keep the retired frame quietly pending until unmount, explicit rejection or this owned deadline.
  useEffect(() => {
    if (
      !retired ||
      !exitAttempt ||
      exitAttempt.failure ||
      exitAttempt.request.owner !== transitionOwner
    )
      return;
    const { request } = exitAttempt;
    const timer = window.setTimeout(() => {
      if (!ownsTransition(request)) return;
      const ownedExit = controlledExitRef.current;
      if (ownedExit?.request === request) {
        controlledExitRef.current = null;
        setPendingExit(null);
        ownedExit.resolve(false);
      }
      failExit(request, "timeout");
    }, READER_EXIT_DEADLINE_MS);
    return () => window.clearTimeout(timer);
  }, [exitAttempt, failExit, ownsTransition, retired, transitionOwner]);

  const runAfterSettlement = useCallback(
    async (
      action: () => void | Promise<void>,
      ownsRequest: () => boolean = () => true,
    ): Promise<boolean> => {
      const owner = transitionOwnerRef.current;
      const owns = () =>
        mountedRef.current && transitionOwnerRef.current === owner && ownsRequest();
      if (!owns()) return false;

      const settled = await settleRef.current();
      if (!settled || !owns()) return false;
      await action();
      return true;
    },
    [],
  );

  const acquireReaderLeaveSettlement = useCallback((): Promise<boolean> => {
    // Route/exit attempts may share a save, but a newer in-reader intent cancels retirement.
    leaveRequestSequenceRef.current = requestSequenceRef.current;
    const owner = transitionOwnerRef.current;
    const activeSettlement = leaveSettlementRef.current;
    if (activeSettlement && activeSettlement.owner === owner) {
      return activeSettlement.promise;
    }

    const ownership: ReaderLeaveSettlementOwnership = {
      owner,
      promise: Promise.resolve(false),
    };
    ownership.promise = settleAndRetireReaderSession({
      owns: () =>
        mountedRef.current &&
        transitionOwnerRef.current === owner &&
        leaveRequestSequenceRef.current === requestSequenceRef.current,
      retire: () => retireRef.current(),
      settle: () => settleRef.current(),
    }).then((settled) => {
      if (leaveSettlementRef.current === ownership) {
        if (!settled) leaveSettlementRef.current = null;
        setPendingSettlement((current) => (current === ownership ? null : current));
      }
      return settled;
    });
    leaveSettlementRef.current = ownership;
    setPendingSettlement(ownership);
    return ownership.promise;
  }, []);

  const leaveReader = useCallback(
    (action: () => void | Promise<void>) => {
      if (controlledExitRef.current) return controlledExitRef.current.promise;

      const request = beginLeave();
      let resolve!: (result: boolean) => void;
      const promise = new Promise<boolean>((settlePromise) => {
        resolve = settlePromise;
      });
      const ownership: ControlledExitOwnership = {
        actionInProgress: false,
        owner: transitionOwnerRef.current,
        promise,
        request,
        resolve,
        settlementComplete: false,
      };
      controlledExitRef.current = ownership;
      setPendingExit(request);

      const finish = (result: boolean) => {
        if (controlledExitRef.current !== ownership) return;
        controlledExitRef.current = null;
        setPendingExit((current) => (current === request ? null : current));
        ownership.resolve(result);
      };

      void Promise.resolve()
        .then(async () => {
          if (controlledExitRef.current !== ownership || !ownsTransition(request)) {
            finish(false);
            return;
          }
          const settled = await acquireReaderLeaveSettlement();
          if (!settled || controlledExitRef.current !== ownership || !ownsTransition(request)) {
            if (!settled) failExit(request, "rejected");
            finish(false);
            return;
          }
          ownership.settlementComplete = true;
          ownership.actionInProgress = true;
          try {
            await action();
          } finally {
            ownership.actionInProgress = false;
          }
          if (!ownership.blockedAttemptId) finish(true);
        })
        .catch(() => {
          failExit(request, "rejected");
          finish(false);
        });
      return promise;
    },
    [acquireReaderLeaveSettlement, beginLeave, failExit, ownsTransition],
  );

  const createRouteNavigationIntent = useCallback((): AsyncRouteIntentOwnership => {
    const ownership = controlledExitRef.current;
    const request =
      ownership &&
      ownership.actionInProgress &&
      !ownership.blockedAttemptId &&
      ownsTransition(ownership.request)
        ? ownership.request
        : beginLeave();
    leaveRequestSequenceRef.current = request.id;
    return {
      owns: () => ownsTransition(request),
      settled: Boolean(ownership?.settlementComplete && ownership.request === request),
    };
  }, [beginLeave, ownsTransition]);

  const handleBlockedNavigationIntent = useCallback(
    (attempt: AsyncBlockedRouteAttempt) => {
      const request = exitRequestRef.current;
      if (request) blockedExitRef.current = { id: attempt.id, request };
      const ownership = controlledExitRef.current;
      if (!ownership || ownership.owner !== transitionOwnerRef.current) return;
      if (
        ownership.actionInProgress &&
        !ownership.blockedAttemptId &&
        ownsTransition(ownership.request)
      ) {
        ownership.blockedAttemptId = attempt.id;
        return;
      }
      controlledExitRef.current = null;
      setPendingExit((current) => (current === ownership.request ? null : current));
      ownership.resolve(false);
    },
    [ownsTransition],
  );

  const handleBlockedNavigationSettled = useCallback(
    (attempt: AsyncBlockedRouteAttempt, settled: boolean) => {
      const blocked = blockedExitRef.current;
      if (blocked?.id === attempt.id) {
        if (!settled) failExit(blocked.request, "rejected");
        blockedExitRef.current = null;
      }
      const ownership = controlledExitRef.current;
      if (
        !ownership ||
        ownership.owner !== transitionOwnerRef.current ||
        ownership.blockedAttemptId !== attempt.id
      ) {
        return;
      }
      controlledExitRef.current = null;
      setPendingExit((current) => (current === ownership.request ? null : current));
      ownership.resolve(settled);
    },
    [failExit],
  );

  const runControlledTransition = useCallback(
    async (action: () => boolean | Promise<boolean>): Promise<boolean> => {
      const request = beginTransition();
      let result = false;
      const settled = await runAfterSettlement(
        async () => {
          result = await action();
        },
        () => ownsTransition(request),
      );
      return settled && ownsTransition(request) && result;
    },
    [beginTransition, ownsTransition, runAfterSettlement],
  );

  useAsyncRouteLeaveGuard({
    onBlockedNavigationIntent: handleBlockedNavigationIntent,
    onBlockedNavigationSettled: handleBlockedNavigationSettled,
    onNavigationIntent: createRouteNavigationIntent,
    ownershipToken: transitionOwner,
    settle: acquireReaderLeaveSettlement,
  });

  useEffect(
    () =>
      archiveStore.registerTransitionGuard(async () => {
        const request = beginLeave();
        const settled = await acquireReaderLeaveSettlement();
        return settled && ownsTransition(request);
      }),
    [acquireReaderLeaveSettlement, beginLeave, ownsTransition],
  );

  return useMemo(
    () => ({
      beginTransition,
      leaveReader,
      exitFailure: exitAttempt?.request.owner === transitionOwner ? exitAttempt.failure : null,
      // Operational ownership only; presentation stays pending beyond this acknowledgement.
      leavePending:
        pendingExit?.owner === transitionOwner || pendingSettlement?.owner === transitionOwner,
      ownsTransition,
      runAfterSettlement,
      runControlledTransition,
    }),
    [
      beginTransition,
      leaveReader,
      ownsTransition,
      pendingExit,
      exitAttempt,
      pendingSettlement,
      transitionOwner,
      runAfterSettlement,
      runControlledTransition,
    ],
  );
}
