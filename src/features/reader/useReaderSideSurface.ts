import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { focusElementIfRestorationOwned } from "../../utils/focusRestoration";
import { activeTransientSurfaceElement } from "../../utils/transientSurfaceOwnership";
import { createReaderSideSurfaceDismissController } from "./readerSideSurfaceDismissal";
import type { useReaderControlledTransitions } from "./useReaderControlledTransitions";

export type ReaderSideSurface = "annotations" | "navigation" | "search" | "settings" | null;

export type ReaderSideSurfaceState<NoteTarget> =
  | { kind: "closed" }
  | { kind: "search" }
  | { kind: "settings" }
  | { kind: "navigation" }
  | {
      kind: "annotations";
      noteTarget?: NoteTarget;
      restoreFocusAnnotationId?: string;
      restoreFocusOnOpen?: boolean;
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
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const navigationButtonRef = useRef<HTMLButtonElement>(null);
  const annotationButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRestorationRef = useRef<PendingFocusRestoration | null>(null);
  const [dismissalController] = useState(createReaderSideSurfaceDismissController);

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
    (
      nextSurface: ReaderSideSurface,
      focusTarget?: MutableRefObject<HTMLButtonElement | null>,
      restoreAnnotationFocus = true,
    ) => {
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
            restoreFocusOnOpen: restoreAnnotationFocus,
            restoreFocusAnnotationId: restoreAnnotationFocus
              ? activeNote
                ? annotationId(activeNote)
                : activeState.kind === "annotations"
                  ? activeState.restoreFocusAnnotationId
                  : undefined
              : undefined,
          };
        } else if (nextSurface === "search") {
          next = { kind: "search" };
        } else if (nextSurface === "settings") {
          next = { kind: "settings" };
        } else if (nextSurface === "navigation") {
          next = { kind: "navigation" };
        } else {
          next = { kind: "closed" };
        }

        const activeSurface = activeTransientSurfaceElement();
        const closingSurface =
          nextSurface === null && activeSurface?.dataset.applicationTransient === "reader-panel"
            ? activeSurface
            : null;
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
              !trigger
            ) {
              return;
            }
            focusElementIfRestorationOwned(trigger, {
              closingSurface,
              requestIsCurrent: () =>
                ownsTransition(request) && surfaceFromState(stateRef.current) === null,
            });
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
        restoreFocusOnOpen: current.kind === "annotations" ? current.restoreFocusOnOpen : undefined,
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

  const openSearch = useCallback(() => transition("search"), [transition]);
  const openSettings = useCallback(() => transition("settings"), [transition]);
  const openNavigation = useCallback(() => transition("navigation"), [transition]);
  const openAnnotations = useCallback(() => transition("annotations"), [transition]);
  const closeSearch = useCallback(() => transition(null, searchButtonRef), [transition]);
  const closeSettings = useCallback(() => transition(null, settingsButtonRef), [transition]);
  const closeNavigation = useCallback(() => transition(null, navigationButtonRef), [transition]);
  const closeAnnotations = useCallback(() => transition(null, annotationButtonRef), [transition]);
  const returnNoteToAnnotations = useCallback(
    (restoreFocus = true) => transition("annotations", undefined, restoreFocus),
    [transition],
  );
  const toggleSearch = useCallback(() => {
    transition(surfaceFromState(stateRef.current) === "search" ? null : "search", searchButtonRef);
  }, [transition]);
  const toggleSettings = useCallback(() => {
    transition(
      surfaceFromState(stateRef.current) === "settings" ? null : "settings",
      settingsButtonRef,
    );
  }, [transition]);
  const toggleNavigation = useCallback(() => {
    transition(
      surfaceFromState(stateRef.current) === "navigation" ? null : "navigation",
      navigationButtonRef,
    );
  }, [transition]);
  const toggleAnnotations = useCallback(() => {
    transition(
      surfaceFromState(stateRef.current) === "annotations" ? null : "annotations",
      annotationButtonRef,
    );
  }, [transition]);

  const closeBaseSurface = useCallback(() => {
    const current = stateRef.current;
    if (current.kind === "annotations" && current.noteTarget) {
      returnNoteToAnnotations();
      return true;
    }
    if (current.kind === "annotations") {
      closeAnnotations();
      return true;
    }
    if (current.kind === "search") {
      closeSearch();
      return true;
    }
    if (current.kind === "navigation") {
      closeNavigation();
      return true;
    }
    if (current.kind === "settings") {
      closeSettings();
      return true;
    }
    return false;
  }, [closeAnnotations, closeNavigation, closeSearch, closeSettings, returnNoteToAnnotations]);

  useLayoutEffect(() => {
    dismissalController.setFallback(closeBaseSurface);
    return () => dismissalController.setFallback(null);
  }, [closeBaseSurface, dismissalController]);

  const closeTopmost = useCallback(
    () => dismissalController.dismissTopmost(),
    [dismissalController],
  );

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
      closeSearch,
      closeSettings,
      closeNavigation,
      closeTopmost,
      dismissalController,
      getNoteTarget,
      noteTarget,
      openAnnotations,
      openSearch,
      openSettings,
      openNavigation,
      restoreFocusAnnotationId:
        state.kind === "annotations" ? state.restoreFocusAnnotationId : undefined,
      restoreAnnotationsFocus:
        state.kind === "annotations" ? state.restoreFocusOnOpen !== false : true,
      searchButtonRef,
      searchOpen: surface === "search",
      settingsButtonRef,
      settingsOpen: surface === "settings",
      showNoteTarget,
      state,
      surface,
      surfaceRef,
      navigationButtonRef,
      navigationOpen: surface === "navigation",
      toggleAnnotations,
      toggleSearch,
      toggleSettings,
      toggleNavigation,
      transition,
      updateNoteTarget,
      returnNoteToAnnotations,
    }),
    [
      closeAnnotations,
      closeSearch,
      closeSettings,
      closeNavigation,
      closeTopmost,
      dismissalController,
      getNoteTarget,
      noteTarget,
      openAnnotations,
      openSearch,
      openSettings,
      openNavigation,
      returnNoteToAnnotations,
      showNoteTarget,
      state,
      surface,
      surfaceRef,
      toggleAnnotations,
      toggleSearch,
      toggleSettings,
      toggleNavigation,
      transition,
      updateNoteTarget,
    ],
  );
}
