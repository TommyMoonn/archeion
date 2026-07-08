export function isReducedMotionPreferred(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isAppMotionEnabled(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return (
    document.documentElement.dataset.motion === "on" &&
    !isReducedMotionPreferred()
  );
}

export function getProgrammaticScrollBehavior(): ScrollBehavior {
  return isAppMotionEnabled() ? "smooth" : "auto";
}

export function scrollElementToTop(element: HTMLElement | null): void {
  if (!element) {
    return;
  }

  const behavior = getProgrammaticScrollBehavior();

  if (typeof element.scrollTo === "function") {
    element.scrollTo({ behavior, top: 0 });
    return;
  }

  element.scrollTop = 0;
}
