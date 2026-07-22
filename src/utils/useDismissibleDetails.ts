import { useCallback, useEffect, useRef, useState } from "react";

import { focusElementIfUsable } from "./focusRestoration";
import { useTransientSurfaceOwnership } from "./transientSurfaceOwnership";

type CloseDetailsOptions = {
  restoreFocus?: boolean;
};

function menuRoot(details: HTMLDetailsElement): HTMLElement | undefined {
  const renderedMenu = details.querySelector<HTMLElement>('[role="menu"]');
  if (renderedMenu) return renderedMenu;

  const summary = details.querySelector("summary");
  if (summary?.getAttribute("aria-haspopup") !== "menu") return undefined;
  return summary.nextElementSibling instanceof HTMLElement ? summary.nextElementSibling : details;
}

function enabledMenuItems(details: HTMLDetailsElement): HTMLElement[] {
  const menu = menuRoot(details);
  if (!menu) return [];

  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'),
  ).filter(
    (item) =>
      !(item instanceof HTMLButtonElement && item.disabled) &&
      item.getAttribute("aria-disabled") !== "true",
  );
}

export function useDismissibleDetails() {
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
    kind: "details-menu",
    onDismiss: (reason) => closeDetails({ restoreFocus: reason === "escape" }),
  });

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    function handleToggle() {
      setIsOpen(details?.open ?? false);
    }

    function handleMenuKeyDown(event: KeyboardEvent) {
      if (!event.key || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const summary = details?.querySelector("summary");
      const target = event.target;
      if (!details || !(target instanceof Node) || !details.contains(target)) return;
      if (!menuRoot(details)) return;

      if (!details.open) {
        if (target !== summary) return;
        details.setAttribute("open", "");
        setIsOpen(true);
      }

      const items = enabledMenuItems(details);
      if (items.length === 0) return;
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? (currentIndex + 1 + items.length) % items.length
              : (currentIndex <= 0 ? items.length : currentIndex) - 1;

      event.preventDefault();
      event.stopPropagation();
      items[nextIndex]?.focus();
    }

    handleToggle();
    details.addEventListener("toggle", handleToggle);
    details.addEventListener("keydown", handleMenuKeyDown);

    return () => {
      details.removeEventListener("toggle", handleToggle);
      details.removeEventListener("keydown", handleMenuKeyDown);
    };
  }, []);

  return { closeDetails, detailsRef };
}
