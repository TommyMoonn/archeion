import { useCallback, useEffect, useRef } from "react";

type CloseDetailsOptions = {
  restoreFocus?: boolean;
};

export function useDismissibleDetails() {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const closeDetails = useCallback((options: CloseDetailsOptions = {}) => {
    const details = detailsRef.current;
    if (!details?.open) {
      return;
    }

    details.removeAttribute("open");
    if (options.restoreFocus) {
      details.querySelector("summary")?.focus();
    }
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!detailsRef.current?.contains(event.target as Node)) {
        closeDetails();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDetails({ restoreFocus: true });
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDetails]);

  return {
    closeDetails,
    detailsRef,
  };
}
