import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { ReaderSessionIdentity } from "./readerSession";
import type {
  ReaderPublicationSearchOutcome,
  ReaderPublicationSearchResult,
} from "./readerPublicationSearch";
import type { ReaderSearchMatchEmphasisOwner } from "./readerSearchMatchEmphasis";

export type ReaderPublicationSearchStatus = "idle" | "searching" | "ready" | "error";
export type ReaderPublicationSearchControllerError = "search-failed";

export type ReaderPublicationSearchControllerState = Readonly<{
  error: ReaderPublicationSearchControllerError | null;
  query: string;
  requestRevision: number;
  results: readonly ReaderPublicationSearchResult[];
  selectedResult: ReaderPublicationSearchResult | null;
  status: ReaderPublicationSearchStatus;
  truncated: boolean;
}>;

type UseReaderPublicationSearchOptions = Readonly<{
  emphasis: ReaderSearchMatchEmphasisOwner;
  navigateToTarget: (target: string) => Promise<boolean>;
  searchPublication: (
    query: string,
    options: Readonly<{ signal?: AbortSignal }>,
  ) => Promise<ReaderPublicationSearchOutcome>;
  sessionIdentity: ReaderSessionIdentity;
}>;

type ActiveSearchRequest = Readonly<{
  controller: AbortController;
  identity: ReaderSessionIdentity;
  revision: number;
}>;

export type ReaderPublicationSearchController = Readonly<{
  close: () => void;
  navigateResult: (resultId: string) => Promise<boolean>;
  navigateSelectedResult: () => Promise<boolean>;
  nextResult: () => Promise<boolean>;
  previousResult: () => Promise<boolean>;
  runtimeEnding: () => void;
  runtimeReady: () => void;
  setQuery: (query: string) => void;
  state: ReaderPublicationSearchControllerState;
}>;

const EMPTY_RESULTS: readonly ReaderPublicationSearchResult[] = Object.freeze([]);

function createState(
  revision: number,
  overrides: Partial<ReaderPublicationSearchControllerState> = {},
): ReaderPublicationSearchControllerState {
  return Object.freeze({
    error: null,
    query: "",
    requestRevision: revision,
    results: EMPTY_RESULTS,
    selectedResult: null,
    status: "idle",
    truncated: false,
    ...overrides,
  });
}

function selectedIndex(state: ReaderPublicationSearchControllerState): number {
  if (!state.selectedResult) return -1;
  return state.results.findIndex((result) => result.id === state.selectedResult?.id);
}

export function useReaderPublicationSearch({
  emphasis,
  navigateToTarget,
  searchPublication,
  sessionIdentity,
}: UseReaderPublicationSearchOptions): ReaderPublicationSearchController {
  const [state, setState] = useState<ReaderPublicationSearchControllerState>(() => createState(0));
  const stateRef = useRef(state);
  const activeRequestRef = useRef<ActiveSearchRequest | null>(null);
  const revisionRef = useRef(0);
  const sessionIdentityRef = useRef(sessionIdentity);
  const runtimeReadyRef = useRef(false);

  const publish = useCallback((next: ReaderPublicationSearchControllerState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const retireActiveRequest = useCallback(() => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    revisionRef.current += 1;
    return revisionRef.current;
  }, []);

  useLayoutEffect(() => {
    sessionIdentityRef.current = sessionIdentity;
    runtimeReadyRef.current = false;
    const revision = retireActiveRequest();
    emphasis.clear();
    publish(createState(revision));

    return () => {
      if (sessionIdentityRef.current !== sessionIdentity) return;
      retireActiveRequest();
      emphasis.clear();
    };
  }, [emphasis, publish, retireActiveRequest, sessionIdentity]);

  const requestIsCurrent = useCallback((request: ActiveSearchRequest) => {
    return (
      activeRequestRef.current === request &&
      sessionIdentityRef.current === request.identity &&
      !request.controller.signal.aborted
    );
  }, []);

  const startSearch = useCallback(
    (query: string, revision: number) => {
      if (!runtimeReadyRef.current || activeRequestRef.current) return;

      const controller = new AbortController();
      const request: ActiveSearchRequest = Object.freeze({
        controller,
        identity: sessionIdentityRef.current,
        revision,
      });
      activeRequestRef.current = request;

      void Promise.resolve()
        .then(() => searchPublication(query, { signal: controller.signal }))
        .then((outcome) => {
          if (!requestIsCurrent(request)) return;
          activeRequestRef.current = null;

          if (outcome.kind === "cancelled") {
            if (!runtimeReadyRef.current) return;
            publish(createState(revision, { query }));
            return;
          }

          if (outcome.failures.length > 0 && outcome.results.length === 0) {
            emphasis.clear();
            publish(
              createState(revision, {
                error: "search-failed",
                query,
                status: "error",
                truncated: outcome.truncated,
              }),
            );
            return;
          }

          emphasis.clear();
          publish(
            createState(revision, {
              query,
              results: outcome.results,
              status: "ready",
              truncated: outcome.truncated,
            }),
          );
        })
        .catch(() => {
          if (!requestIsCurrent(request)) return;
          activeRequestRef.current = null;
          emphasis.clear();
          publish(
            createState(revision, {
              error: "search-failed",
              query,
              status: "error",
            }),
          );
        });
    },
    [emphasis, publish, requestIsCurrent, searchPublication],
  );

  const setQuery = useCallback(
    (query: string) => {
      const revision = retireActiveRequest();
      emphasis.clear();

      if (!query.trim()) {
        publish(createState(revision, { query }));
        return;
      }

      publish(
        createState(revision, {
          query,
          status: "searching",
        }),
      );
      startSearch(query, revision);
    },
    [emphasis, publish, retireActiveRequest, startSearch],
  );

  const runtimeEnding = useCallback(() => {
    if (!runtimeReadyRef.current) return;
    runtimeReadyRef.current = false;

    const current = stateRef.current;
    if (current.status !== "searching" || !current.query.trim()) return;

    const revision = retireActiveRequest();
    publish(
      createState(revision, {
        query: current.query,
        status: "searching",
      }),
    );
  }, [publish, retireActiveRequest]);

  const runtimeReady = useCallback(() => {
    runtimeReadyRef.current = true;
    const current = stateRef.current;

    if (current.status === "ready" && current.selectedResult) {
      emphasis.show(current.selectedResult.target);
      return;
    }

    if (current.status === "searching" && current.query.trim() && !activeRequestRef.current) {
      startSearch(current.query, current.requestRevision);
    }
  }, [emphasis, startSearch]);

  const close = useCallback(() => {
    const revision = retireActiveRequest();
    emphasis.clear();
    publish(createState(revision));
  }, [emphasis, publish, retireActiveRequest]);

  const navigateResult = useCallback(
    async (resultId: string) => {
      const current = stateRef.current;
      const result = current.results.find((candidate) => candidate.id === resultId);
      if (!result || current.status !== "ready") return false;

      const revision = current.requestRevision;
      const identity = sessionIdentityRef.current;
      try {
        const navigated = await navigateToTarget(result.target);
        if (!navigated) return false;

        const liveState = stateRef.current;
        const liveResult = liveState.results.find((candidate) => candidate.id === result.id);
        if (
          !liveResult ||
          liveState.status !== "ready" ||
          liveState.requestRevision !== revision ||
          sessionIdentityRef.current !== identity
        ) {
          return false;
        }

        emphasis.show(liveResult.target);
        if (liveState.selectedResult?.id !== liveResult.id) {
          publish(
            createState(liveState.requestRevision, { ...liveState, selectedResult: liveResult }),
          );
        }
        return true;
      } catch {
        return false;
      }
    },
    [emphasis, navigateToTarget, publish],
  );

  const navigateSelectedResult = useCallback(async () => {
    const selected = stateRef.current.selectedResult;
    return selected ? navigateResult(selected.id) : false;
  }, [navigateResult]);

  const navigateAdjacentResult = useCallback(
    async (direction: "next" | "previous") => {
      const current = stateRef.current;
      if (current.status !== "ready" || current.results.length === 0) return false;

      const currentIndex = selectedIndex(current);
      // Result traversal wraps at both ends rather than clamping on a boundary.
      const nextIndex =
        direction === "next"
          ? currentIndex < 0
            ? 0
            : (currentIndex + 1) % current.results.length
          : currentIndex < 0
            ? current.results.length - 1
            : (currentIndex - 1 + current.results.length) % current.results.length;
      const result = current.results[nextIndex];
      return result ? navigateResult(result.id) : false;
    },
    [navigateResult],
  );

  return {
    close,
    navigateResult,
    navigateSelectedResult,
    nextResult: () => navigateAdjacentResult("next"),
    previousResult: () => navigateAdjacentResult("previous"),
    runtimeEnding,
    runtimeReady,
    setQuery,
    state,
  };
}
