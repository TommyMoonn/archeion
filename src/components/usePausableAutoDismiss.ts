import {
  useCallback,
  useEffect,
  useRef,
  type FocusEventHandler,
  type MouseEventHandler,
} from "react";

type UsePausableAutoDismissInput = {
  durationMs: number;
  enabled: boolean;
  onDismiss: () => void;
  resetKey: unknown;
};

type PausableAutoDismissHandlers<T extends HTMLElement> = {
  onBlurCapture: FocusEventHandler<T>;
  onFocusCapture: FocusEventHandler<T>;
  onMouseEnter: MouseEventHandler<T>;
  onMouseLeave: MouseEventHandler<T>;
};

export function usePausableAutoDismiss<T extends HTMLElement>({
  durationMs,
  enabled,
  onDismiss,
  resetKey,
}: UsePausableAutoDismissInput): PausableAutoDismissHandlers<T> {
  const dismissRef = useRef(onDismiss);
  const pauseReasonsRef = useRef({ focus: false, hover: false });
  const remainingMsRef = useRef(durationMs);
  const startedAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const schedule = useCallback(() => {
    clearTimer();
    if (
      !enabled ||
      pauseReasonsRef.current.focus ||
      pauseReasonsRef.current.hover ||
      remainingMsRef.current <= 0
    ) {
      return;
    }

    startedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      startedAtRef.current = null;
      dismissRef.current();
    }, remainingMsRef.current);
  }, [clearTimer, enabled]);

  const pause = useCallback(
    (reason: "focus" | "hover") => {
      pauseReasonsRef.current[reason] = true;
      if (startedAtRef.current !== null) {
        remainingMsRef.current = Math.max(
          0,
          remainingMsRef.current - (Date.now() - startedAtRef.current),
        );
      }
      startedAtRef.current = null;
      clearTimer();
    },
    [clearTimer],
  );

  const resume = useCallback(
    (reason: "focus" | "hover") => {
      pauseReasonsRef.current[reason] = false;
      schedule();
    },
    [schedule],
  );

  useEffect(() => {
    remainingMsRef.current = durationMs;
    startedAtRef.current = null;
    schedule();
    return clearTimer;
  }, [clearTimer, durationMs, resetKey, schedule]);

  return {
    onBlurCapture: (event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      resume("focus");
    },
    onFocusCapture: () => pause("focus"),
    onMouseEnter: () => pause("hover"),
    onMouseLeave: () => resume("hover"),
  };
}
