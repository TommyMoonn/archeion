import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

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
  retire: () => void | Promise<void>;
  settle: () => Promise<boolean>;
};

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
  const controlledExitRef = useRef<ControlledExitOwnership | null>(null);
  const leaveSettlementRef = useRef<ReaderLeaveSettlementOwnership | null>(null);

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
      owns: () => mountedRef.current && transitionOwnerRef.current === owner,
      retire: () => retireRef.current(),
      settle: () => settleRef.current(),
    }).then((settled) => {
      if (!settled && leaveSettlementRef.current === ownership) {
        leaveSettlementRef.current = null;
      }
      return settled;
    });
    leaveSettlementRef.current = ownership;
    return ownership.promise;
  }, []);

  const leaveReader = useCallback(
    (action: () => void | Promise<void>) => {
      if (controlledExitRef.current) return controlledExitRef.current.promise;

      const request = beginTransition();
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

      const finish = (result: boolean) => {
        if (controlledExitRef.current !== ownership) return;
        controlledExitRef.current = null;
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
        .catch(() => finish(false));
      return promise;
    },
    [acquireReaderLeaveSettlement, beginTransition, ownsTransition],
  );

  const createRouteNavigationIntent = useCallback((): AsyncRouteIntentOwnership => {
    const ownership = controlledExitRef.current;
    const request =
      ownership &&
      ownership.actionInProgress &&
      !ownership.blockedAttemptId &&
      ownsTransition(ownership.request)
        ? ownership.request
        : beginTransition();
    return {
      owns: () => ownsTransition(request),
      settled: Boolean(ownership?.settlementComplete && ownership.request === request),
    };
  }, [beginTransition, ownsTransition]);

  const handleBlockedNavigationIntent = useCallback(
    (attempt: AsyncBlockedRouteAttempt) => {
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
      ownership.resolve(false);
    },
    [ownsTransition],
  );

  const handleBlockedNavigationSettled = useCallback(
    (attempt: AsyncBlockedRouteAttempt, settled: boolean) => {
      const ownership = controlledExitRef.current;
      if (
        !ownership ||
        ownership.owner !== transitionOwnerRef.current ||
        ownership.blockedAttemptId !== attempt.id
      ) {
        return;
      }
      controlledExitRef.current = null;
      ownership.resolve(settled);
    },
    [],
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
      return settled && result;
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
        const request = beginTransition();
        const settled = await acquireReaderLeaveSettlement();
        return settled && ownsTransition(request);
      }),
    [acquireReaderLeaveSettlement, beginTransition, ownsTransition],
  );

  return useMemo(
    () => ({
      beginTransition,
      leaveReader,
      ownsTransition,
      runAfterSettlement,
      runControlledTransition,
    }),
    [beginTransition, leaveReader, ownsTransition, runAfterSettlement, runControlledTransition],
  );
}
