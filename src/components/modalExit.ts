import { isAppMotionEnabled } from "../utils/motion";

/** Animation promises handle cancellation; the measured deadline also covers missing events. */
export function waitForModalExit(dialog: HTMLDialogElement, complete: () => void): () => void {
  let active = true;
  let timer: number | undefined;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finish = () => {
    if (!active) return;
    active = false;
    cleanup();
    complete();
  };
  const checkMotion = () => {
    if (!isAppMotionEnabled()) finish();
  };
  const observer = new MutationObserver(checkMotion);
  const cleanup = () => {
    window.clearTimeout(timer);
    observer.disconnect();
    media.removeEventListener("change", checkMotion);
  };

  if (!isAppMotionEnabled()) {
    finish();
  } else {
    const animations = dialog.getAnimations?.() ?? [];
    const remaining = animations.map((animation) => {
      const end = Number(animation.effect?.getComputedTiming().endTime ?? 0);
      return Number.isFinite(end) ? Math.max(0, end - Number(animation.currentTime ?? 0)) : 0;
    });
    const deadline = Math.max(0, ...remaining);
    if (deadline === 0) finish();
    else {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-motion"],
      });
      media.addEventListener("change", checkMotion);
      timer = window.setTimeout(finish, deadline);
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
    }
  }
  return () => {
    active = false;
    cleanup();
  };
}
