import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import {
  useAsyncRouteLeaveGuard,
  type AsyncBlockedRouteAttempt,
  type AsyncRouteIntentOwnership,
} from "../../app/useAsyncRouteLeaveGuard";
import { archiveStore } from "../../stores/archiveStore";

export type ReaderTransitionRequest = {
  id: number;
  sessionKey?: string;
};

type ReaderControlledTransitionOptions = {
  onTransitionIntent: () => void;
  sessionKey?: string;
  settle: () => Promise<boolean>;
  settleArchiveTransition?: () => Promise<boolean>;
};

type ControlledExitOwnership = {
  actionInProgress: boolean;
  blockedAttemptId?: symbol;
  promise: Promise<boolean>;
  request: ReaderTransitionRequest;
  resolve: (result: boolean) => void;
  sessionKey?: string;
};

export function useReaderControlledTransitions({
  onTransitionIntent,
  sessionKey,
  settle,
  settleArchiveTransition = settle,
}: ReaderControlledTransitionOptions) {
  const mountedRef = useRef(true);
  const sessionKeyRef = useRef(sessionKey);
  const intentRef = useRef(onTransitionIntent);
  const settleRef = useRef(settle);
  const archiveSettleRef = useRef(settleArchiveTransition);
  const requestSequenceRef = useRef(0);
  const controlledExitRef = useRef<ControlledExitOwnership | null>(null);

  useLayoutEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      const ownedExit = controlledExitRef.current;
      controlledExitRef.current = null;
      ownedExit?.resolve(false);
    }
    sessionKeyRef.current = sessionKey;
    intentRef.current = onTransitionIntent;
    settleRef.current = settle;
    archiveSettleRef.current = settleArchiveTransition;
  }, [onTransitionIntent, sessionKey, settle, settleArchiveTransition]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      controlledExitRef.current?.resolve(false);
      controlledExitRef.current = null;
    };
  }, []);

  const beginTransition = useCallback((): ReaderTransitionRequest => {
    intentRef.current();
    return {
      id: ++requestSequenceRef.current,
      sessionKey: sessionKeyRef.current,
    };
  }, []);

  const ownsTransition = useCallback(
    (request: ReaderTransitionRequest) =>
      mountedRef.current &&
      requestSequenceRef.current === request.id &&
      sessionKeyRef.current === request.sessionKey,
    [],
  );

  const runAfterSettlement = useCallback(
    async (
      action: () => void | Promise<void>,
      ownsRequest: () => boolean = () => true,
    ): Promise<boolean> => {
      const ownerSessionKey = sessionKeyRef.current;
      const owns = () =>
        mountedRef.current && sessionKeyRef.current === ownerSessionKey && ownsRequest();
      if (!owns()) return false;

      const settled = await settleRef.current();
      if (!settled || !owns()) return false;
      await action();
      return true;
    },
    [],
  );

  const runControlledExit = useCallback(
    (action: () => void | Promise<void>) => {
      if (controlledExitRef.current) return controlledExitRef.current.promise;

      const request = beginTransition();
      let resolve!: (result: boolean) => void;
      const promise = new Promise<boolean>((settlePromise) => {
        resolve = settlePromise;
      });
      const ownership: ControlledExitOwnership = {
        actionInProgress: false,
        promise,
        request,
        resolve,
        sessionKey: sessionKeyRef.current,
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
    [beginTransition, ownsTransition],
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
    return { owns: () => ownsTransition(request) };
  }, [beginTransition, ownsTransition]);

  const handleBlockedNavigationIntent = useCallback(
    (attempt: AsyncBlockedRouteAttempt) => {
      const ownership = controlledExitRef.current;
      if (!ownership || ownership.sessionKey !== sessionKeyRef.current) return;
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
        ownership.sessionKey !== sessionKeyRef.current ||
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
    sessionKey,
    settle,
  });

  useEffect(
    () =>
      archiveStore.registerTransitionGuard(async () => {
        const request = beginTransition();
        const settled = await archiveSettleRef.current();
        return settled && ownsTransition(request);
      }),
    [beginTransition, ownsTransition],
  );

  return useMemo(
    () => ({
      beginTransition,
      ownsTransition,
      runAfterSettlement,
      runControlledExit,
      runControlledTransition,
    }),
    [
      beginTransition,
      ownsTransition,
      runAfterSettlement,
      runControlledExit,
      runControlledTransition,
    ],
  );
}
