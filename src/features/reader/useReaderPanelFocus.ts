import { useCallback, useContext, useLayoutEffect, useRef } from "react";

import { focusElementIfRestorationOwned } from "../../utils/focusRestoration";
import { ReaderPanelFrameContext } from "./readerPanelFrameContext";

/** A frame may hand its automatic fallback focus to ready content, until the next user action. */
export function useReaderPanelFocus() {
  const host = useContext(ReaderPanelFrameContext);
  const hostedFocus = host?.focusInitialTarget;
  const originRef = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const eligibleRef = useRef(true);
  const focusingRef = useRef(false);

  useLayoutEffect(() => {
    if (hostedFocus) return;
    eligibleRef.current = true;
    const cancel = () => {
      eligibleRef.current = false;
    };
    const focusChanged = () => {
      if (!focusingRef.current && document.activeElement !== originRef.current) cancel();
    };
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("keydown", cancel);
    window.addEventListener("focusin", focusChanged);
    return () => {
      eligibleRef.current = false;
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("focusin", focusChanged);
    };
  }, [hostedFocus]);

  return useCallback(
    (target: HTMLElement | null) => {
      if (hostedFocus) return hostedFocus(target);
      if (!eligibleRef.current || !target) return false;
      focusingRef.current = true;
      const focused = focusElementIfRestorationOwned(target, {
        invalidatedOrigin: originRef.current,
      });
      focusingRef.current = false;
      if (focused) originRef.current = target;
      return focused;
    },
    [hostedFocus],
  );
}
