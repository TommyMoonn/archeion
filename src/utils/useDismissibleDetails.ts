import { useCallback, useEffect, useRef } from "react";

type CloseDetailsOptions = {
  restoreFocus?: boolean;
};

const openDetailsStack: HTMLDetailsElement[] = [];

function unregisterOpenDetails(details: HTMLDetailsElement) {
  const index = openDetailsStack.indexOf(details);
  if (index >= 0) openDetailsStack.splice(index, 1);
}

function registerOpenDetails(details: HTMLDetailsElement) {
  unregisterOpenDetails(details);
  openDetailsStack.push(details);
}

function topOpenDetails(): HTMLDetailsElement | undefined {
  while (openDetailsStack.length > 0) {
    const candidate = openDetailsStack.at(-1);
    if (candidate?.isConnected && candidate.open) return candidate;
    if (candidate) unregisterOpenDetails(candidate);
  }
  return undefined;
}

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

  const closeDetails = useCallback((options: CloseDetailsOptions = {}) => {
    const details = detailsRef.current;
    if (!details?.open) {
      return;
    }

    details.removeAttribute("open");
    unregisterOpenDetails(details);
    if (options.restoreFocus) {
      details.querySelector("summary")?.focus();
    }
  }, []);

  useEffect(() => {
    const mountedDetails = detailsRef.current;
    if (!mountedDetails) return;
    const details: HTMLDetailsElement = mountedDetails;

    function handleToggle() {
      if (details.open) registerOpenDetails(details);
      else unregisterOpenDetails(details);
    }

    function handleMenuKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (event.defaultPrevented || topOpenDetails() !== details) return;
        event.preventDefault();
        event.stopPropagation();
        closeDetails({ restoreFocus: true });
        return;
      }

      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const summary = details.querySelector("summary");
      const target = event.target;
      if (!(target instanceof Node) || !details.contains(target)) return;
      if (!menuRoot(details)) return;

      if (!details.open) {
        if (target !== summary) return;
        details.setAttribute("open", "");
        registerOpenDetails(details);
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

    function handlePointerDown(event: PointerEvent) {
      if (!details.contains(event.target as Node)) {
        closeDetails();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!event.defaultPrevented && event.key === "Escape" && topOpenDetails() === details) {
        event.preventDefault();
        event.stopPropagation();
        closeDetails({ restoreFocus: true });
      }
    }

    handleToggle();
    details.addEventListener("toggle", handleToggle);
    details.addEventListener("keydown", handleMenuKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      unregisterOpenDetails(details);
      details.removeEventListener("toggle", handleToggle);
      details.removeEventListener("keydown", handleMenuKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDetails]);

  return {
    closeDetails,
    detailsRef,
  };
}
