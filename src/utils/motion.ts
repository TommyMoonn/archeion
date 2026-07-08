export function isAppMotionEnabled(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement.dataset.motion === "on";
}

export function getProgrammaticScrollBehavior(): ScrollBehavior {
  return isAppMotionEnabled() ? "smooth" : "auto";
}
