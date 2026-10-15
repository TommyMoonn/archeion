import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { isAppMotionEnabled } from "../../utils/motion";
import { ReaderSideSurfaceLayer } from "./ReaderSideSurfaceLayer";

type DrawerPhase = "closed" | "opening" | "open" | "closing";

type ReaderSideDrawerProps = {
  children: ReactNode;
  onDismiss: () => void;
  open: boolean;
};

/** Retains only the exiting content. Domain state and dismissal remain with their existing owners. */
export function ReaderSideDrawer({ children, onDismiss, open }: ReaderSideDrawerProps) {
  const [retainedChildren, setRetainedChildren] = useState(open ? children : null);
  const [wasOpen, setWasOpen] = useState(open);
  const [phase, setPhase] = useState<DrawerPhase>(() =>
    open && !isAppMotionEnabled() ? "open" : "closed",
  );
  const drawerRef = useRef<HTMLDivElement>(null);
  const present = open || retainedChildren !== null;

  if (open && retainedChildren !== children) setRetainedChildren(children);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setPhase("closing");
    else if (phase === "closed") setPhase(isAppMotionEnabled() ? "closed" : "open");
    else setPhase("opening");
  }

  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer || !present || !open) return;
    if (drawer.dataset.state === "closed" && isAppMotionEnabled()) {
      // Commit the measured off-edge position before changing the transition target.
      drawer.getBoundingClientRect();
      const frame = window.requestAnimationFrame(() => setPhase("opening"));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [open, present]);

  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer || (phase !== "opening" && phase !== "closing")) return;
    if ((phase === "opening") !== open) return;

    // Each effect owns one target. Reversal/teardown invalidates both event and promise completions.
    let current = true;
    const complete = () => {
      if (!current) return;
      current = false;
      if (open) setPhase("open");
      else {
        setRetainedChildren(null);
        setPhase("closed");
      }
    };
    const ended = (event: TransitionEvent) => {
      if (
        event.target === drawer &&
        event.propertyName === "transform" &&
        transitions.every((animation) => animation.playState === "finished")
      )
        complete();
    };
    drawer.addEventListener("transitionend", ended);
    const transitions = (drawer.getAnimations?.() ?? []).filter(
      (animation) =>
        "transitionProperty" in animation && animation.transitionProperty === "transform",
    );
    if (transitions.length) {
      // Covers canceled transitions and runtimes that omit transitionend, without guessing a timeout.
      void Promise.allSettled(transitions.map((animation) => animation.finished)).then(complete);
    } else complete();

    return () => {
      current = false;
      drawer.removeEventListener("transitionend", ended);
    };
  }, [open, phase]);

  if (!present) return null;

  return (
    <ReaderSideSurfaceLayer active={open} onDismiss={onDismiss}>
      <div className="reader-side-drawer" data-state={phase} ref={drawerRef}>
        {open ? children : retainedChildren}
      </div>
    </ReaderSideSurfaceLayer>
  );
}
