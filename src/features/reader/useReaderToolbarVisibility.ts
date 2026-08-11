import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type PointerEventHandler,
  type RefCallback,
} from "react";

const READER_TOOLBAR_IDLE_MS = 2_400;

type ReaderToolbarVisibility = {
  activate: () => void;
  deactivate: () => void;
  expanded: boolean;
  onToolbarBlurCapture: FocusEventHandler<HTMLDivElement>;
  onToolbarFocusCapture: FocusEventHandler<HTMLDivElement>;
  onToolbarPointerEnter: PointerEventHandler<HTMLDivElement>;
  onToolbarPointerLeave: PointerEventHandler<HTMLDivElement>;
  reveal: (focusToolbar: boolean) => void;
  revealControlVisible: boolean;
  setSideSurfaceOwned: (owned: boolean) => void;
  toolbarEntryRef: RefCallback<HTMLButtonElement>;
};

export function useReaderToolbarVisibility(): ReaderToolbarVisibility {
  const [visible, setVisible] = useState(true);
  const [focusHandoffPending, setFocusHandoffPending] = useState(false);
  const timerRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  const sideSurfaceOwnedRef = useRef(false);
  const toolbarEntryElementRef = useRef<HTMLButtonElement | null>(null);

  const clearCollapseTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const canCollapse = useCallback(
    () =>
      activeRef.current &&
      !pointerInsideRef.current &&
      !focusInsideRef.current &&
      !sideSurfaceOwnedRef.current,
    [],
  );

  const scheduleCollapse = useCallback(() => {
    clearCollapseTimer();
    if (!canCollapse()) return;

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (canCollapse()) setVisible(false);
    }, READER_TOOLBAR_IDLE_MS);
  }, [canCollapse, clearCollapseTimer]);

  useEffect(() => clearCollapseTimer, [clearCollapseTimer]);

  const activate = useCallback(() => {
    activeRef.current = true;
    clearCollapseTimer();
    setVisible(true);
    scheduleCollapse();
  }, [clearCollapseTimer, scheduleCollapse]);

  const deactivate = useCallback(() => {
    activeRef.current = false;
    clearCollapseTimer();
    setVisible(true);
    setFocusHandoffPending(false);
  }, [clearCollapseTimer]);

  const setSideSurfaceOwned = useCallback(
    (owned: boolean) => {
      sideSurfaceOwnedRef.current = owned;
      clearCollapseTimer();
      setVisible(true);
      if (!owned) scheduleCollapse();
    },
    [clearCollapseTimer, scheduleCollapse],
  );

  const reveal = useCallback(
    (focusToolbar: boolean) => {
      clearCollapseTimer();
      setVisible(true);
      if (focusToolbar) setFocusHandoffPending(true);
      scheduleCollapse();
    },
    [clearCollapseTimer, scheduleCollapse],
  );

  const onToolbarPointerEnter = useCallback(() => {
    pointerInsideRef.current = true;
    clearCollapseTimer();
  }, [clearCollapseTimer]);

  const onToolbarPointerLeave = useCallback(() => {
    pointerInsideRef.current = false;
    scheduleCollapse();
  }, [scheduleCollapse]);

  const onToolbarFocusCapture = useCallback(() => {
    focusInsideRef.current = true;
    clearCollapseTimer();
    setFocusHandoffPending(false);
  }, [clearCollapseTimer]);

  const onToolbarBlurCapture = useCallback<FocusEventHandler<HTMLDivElement>>(
    (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
      focusInsideRef.current = false;
      scheduleCollapse();
    },
    [scheduleCollapse],
  );

  const toolbarEntryRef = useCallback<RefCallback<HTMLButtonElement>>(
    (node) => {
      toolbarEntryElementRef.current = node;
      if (!node || !focusHandoffPending) return;
      node.focus({ preventScroll: true });
    },
    [focusHandoffPending],
  );

  return {
    activate,
    deactivate,
    expanded: visible,
    onToolbarBlurCapture,
    onToolbarFocusCapture,
    onToolbarPointerEnter,
    onToolbarPointerLeave,
    reveal,
    revealControlVisible: !visible || focusHandoffPending,
    setSideSurfaceOwned,
    toolbarEntryRef,
  };
}
