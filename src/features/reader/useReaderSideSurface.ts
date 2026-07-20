import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import type { useReaderControlledTransitions } from "./useReaderControlledTransitions";

export type ReaderSideSurface = "annotations" | "settings" | "toc" | null;

export type ReaderSideSurfaceState<NoteTarget> =
  | { kind: "closed" }
  | { kind: "settings" }
  | { kind: "toc" }
  | {
      kind: "annotations";
      noteTarget?: NoteTarget;
      restoreFocusAnnotationId?: string;
    };

type ReaderTransitionController = Pick<
  ReturnType<typeof useReaderControlledTransitions>,
  "beginTransition" | "ownsTransition" | "runAfterSettlement"
>;

type ReaderSideSurfaceOptions<NoteTarget> = {
  annotationId: (target: NoteTarget) => string;
  revealControls: () => void;
  transitions: ReaderTransitionController;
};

type PendingFocusRestoration = {
  frameId: number | null;
};

function surfaceFromState<NoteTarget>(
  state: ReaderSideSurfaceState<NoteTarget>,
): ReaderSideSurface {
  return state.kind === "closed" ? null : state.kind;
}

export function useReaderSideSurface<NoteTarget>({
  annotationId,
  revealControls,
  transitions,
}: ReaderSideSurfaceOptions<NoteTarget>) {
  const { beginTransition, ownsTransition, runAfterSettlement } = transitions;
  const [state, setState] = useState<ReaderSideSurfaceState<NoteTarget>>({ kind: "closed" });
  const stateRef = useRef(state);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const tocButtonRef = useRef<HTMLButtonElement>(null);
  const annotationButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRestorationRef = useRef<PendingFocusRestoration | null>(null);

  const cancelFocusRestoration = useCallback(() => {
    const pending = pendingFocusRestorationRef.current;
    if (!pending) return;
    pendingFocusRestorationRef.current = null;
    if (pending.frameId !== null) window.cancelAnimationFrame(pending.frameId);
  }, []);

  useEffect(() => cancelFocusRestoration, [cancelFocusRestoration]);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const publishState = useCallback((next: ReaderSideSurfaceState<NoteTarget>) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const transition = useCallback(
    (nextSurface: ReaderSideSurface, focusTarget?: MutableRefObject<HTMLButtonElement | null>) => {
      cancelFocusRestoration();
      revealControls();
      const request = beginTransition();
      const activeState = stateRef.current;
      const activeNote = activeState.kind === "annotations" ? activeState.noteTarget : undefined;

      const applyTransition = () => {
        if (!ownsTransition(request)) return;

        let next: ReaderSideSurfaceState<NoteTarget>;
        if (nextSurface === "annotations") {
          next = {
            kind: "annotations",
            restoreFocusAnnotationId: activeNote
              ? annotationId(activeNote)
              : activeState.kind === "annotations"
                ? activeState.restoreFocusAnnotationId
                : undefined,
          };
        } else if (nextSurface === "settings") {
          next = { kind: "settings" };
        } else if (nextSurface === "toc") {
          next = { kind: "toc" };
        } else {
          next = { kind: "closed" };
        }

        publishState(next);
        if (nextSurface === null && focusTarget) {
          const focusRestoration: PendingFocusRestoration = { frameId: null };
          pendingFocusRestorationRef.current = focusRestoration;
          const frameId = window.requestAnimationFrame(() => {
            if (pendingFocusRestorationRef.current !== focusRestoration) return;
            pendingFocusRestorationRef.current = null;
            const trigger = focusTarget.current;
            if (
              !ownsTransition(request) ||
              surfaceFromState(stateRef.current) !== null ||
              !trigger?.isConnected
            ) {
              return;
            }
            trigger.focus();
          });
          focusRestoration.frameId = frameId;
        }
      };

      if (activeNote) {
        void runAfterSettlement(applyTransition, () => ownsTransition(request));
      } else {
        applyTransition();
      }
    },
    [
      annotationId,
      beginTransition,
      cancelFocusRestoration,
      ownsTransition,
      publishState,
      revealControls,
      runAfterSettlement,
    ],
  );

  const showNoteTarget = useCallback(
    (target: NoteTarget) => {
      cancelFocusRestoration();
      beginTransition();
      const current = stateRef.current;
      publishState({
        kind: "annotations",
        noteTarget: target,
        restoreFocusAnnotationId:
          current.kind === "annotations" ? current.restoreFocusAnnotationId : undefined,
      });
    },
    [beginTransition, cancelFocusRestoration, publishState],
  );

  const updateNoteTarget = useCallback(
    (target: NoteTarget) => {
      cancelFocusRestoration();
      const current = stateRef.current;
      if (current.kind !== "annotations" || !current.noteTarget) return;
      publishState({ ...current, noteTarget: target });
    },
    [cancelFocusRestoration, publishState],
  );

  const openSettings = useCallback(() => transition("settings"), [transition]);
  const openToc = useCallback(() => transition("toc"), [transition]);
  const openAnnotations = useCallback(() => transition("annotations"), [transition]);
  const closeSettings = useCallback(() => transition(null, settingsButtonRef), [transition]);
  const closeToc = useCallback(() => transition(null, tocButtonRef), [transition]);
  const closeAnnotations = useCallback(() => transition(null, annotationButtonRef), [transition]);
  const returnNoteToAnnotations = useCallback(() => transition("annotations"), [transition]);
  const toggleSettings = useCallback(() => {
    transition(
      surfaceFromState(stateRef.current) === "settings" ? null : "settings",
      settingsButtonRef,
    );
  }, [transition]);
  const toggleToc = useCallback(() => {
    transition(surfaceFromState(stateRef.current) === "toc" ? null : "toc", tocButtonRef);
  }, [transition]);
  const toggleAnnotations = useCallback(() => {
    transition(
      surfaceFromState(stateRef.current) === "annotations" ? null : "annotations",
      annotationButtonRef,
    );
  }, [transition]);

  const closeTopmost = useCallback(() => {
    const current = stateRef.current;
    if (current.kind === "annotations" && current.noteTarget) {
      returnNoteToAnnotations();
      return true;
    }
    if (current.kind === "annotations") {
      closeAnnotations();
      return true;
    }
    if (current.kind === "toc") {
      closeToc();
      return true;
    }
    if (current.kind === "settings") {
      closeSettings();
      return true;
    }
    return false;
  }, [closeAnnotations, closeSettings, closeToc, returnNoteToAnnotations]);

  const surface = surfaceFromState(state);
  const noteTarget = state.kind === "annotations" ? state.noteTarget : undefined;
  const getNoteTarget = useCallback(() => {
    const current = stateRef.current;
    return current.kind === "annotations" ? (current.noteTarget ?? null) : null;
  }, []);
  const surfaceRef = useMemo(
    () =>
      ({
        get current() {
          return surfaceFromState(stateRef.current);
        },
      }) as MutableRefObject<ReaderSideSurface>,
    [],
  );

  return useMemo(
    () => ({
      annotationButtonRef,
      annotationsOpen: surface === "annotations",
      closeAnnotations,
      closeSettings,
      closeToc,
      closeTopmost,
      getNoteTarget,
      noteTarget,
      openAnnotations,
      openSettings,
      openToc,
      restoreFocusAnnotationId:
        state.kind === "annotations" ? state.restoreFocusAnnotationId : undefined,
      settingsButtonRef,
      settingsOpen: surface === "settings",
      showNoteTarget,
      state,
      surface,
      surfaceRef,
      tocButtonRef,
      tocOpen: surface === "toc",
      toggleAnnotations,
      toggleSettings,
      toggleToc,
      transition,
      updateNoteTarget,
      returnNoteToAnnotations,
    }),
    [
      closeAnnotations,
      closeSettings,
      closeToc,
      closeTopmost,
      getNoteTarget,
      noteTarget,
      openAnnotations,
      openSettings,
      openToc,
      returnNoteToAnnotations,
      showNoteTarget,
      state,
      surface,
      surfaceRef,
      toggleAnnotations,
      toggleSettings,
      toggleToc,
      transition,
      updateNoteTarget,
    ],
  );
}
