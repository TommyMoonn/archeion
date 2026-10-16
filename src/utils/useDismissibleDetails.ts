import { useCallback, useEffect, useRef, useState } from "react";

import { focusElementIfUsable } from "./focusRestoration";
import { useTransientSurfaceOwnership } from "./transientSurfaceOwnership";

type CloseDetailsOptions = {
  restoreFocus?: boolean;
};

/** Reattach when a deferred portal supplies the disclosure's DOM host. */
export function useDismissibleDetails(portalHost?: HTMLElement | null) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const closeDetails = useCallback((options: CloseDetailsOptions = {}) => {
    const details = detailsRef.current;
    if (!details?.open) return;

    details.removeAttribute("open");
    setIsOpen(false);
    if (options.restoreFocus) focusElementIfUsable(details.querySelector("summary"));
  }, []);

  useTransientSurfaceOwnership({
    active: isOpen,
    closeOnModalOpen: true,
    dismissOnOutsidePointer: true,
    elementRef: detailsRef,
    kind: "details-disclosure",
    onDismiss: (reason) => closeDetails({ restoreFocus: reason === "escape" }),
  });

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    function handleToggle() {
      setIsOpen(details?.open ?? false);
    }

    handleToggle();
    details.addEventListener("toggle", handleToggle);

    return () => {
      details.removeEventListener("toggle", handleToggle);
    };
  }, [portalHost]);

  return { closeDetails, detailsRef };
}
