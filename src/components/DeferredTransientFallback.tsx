import { useEffect, useState, type ReactNode } from "react";

export const TRANSIENT_FALLBACK_REVEAL_DELAY_MS = 600;

type DeferredTransientFallbackProps = {
  children: ReactNode;
};

export function DeferredTransientFallback({ children }: DeferredTransientFallbackProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsVisible(true);
    }, TRANSIENT_FALLBACK_REVEAL_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return isVisible ? children : null;
}
