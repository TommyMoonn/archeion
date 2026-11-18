import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useLandingMotion } from "./useLandingMotion";

export function usePointerDecoration(kind: "download" | "preview") {
  const enabled = useLandingMotion(true);
  const target = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const frame = useRef(0);
  const latest = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const reset = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    latest.current = null;
    animation.current?.cancel();
    animation.current = null;
    setPoint(null);
  };
  useEffect(() => {
    const resetFrame = requestAnimationFrame(reset);
    window.addEventListener("blur", reset);
    return () => {
      cancelAnimationFrame(resetFrame);
      window.removeEventListener("blur", reset);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      latest.current = null;
      animation.current?.cancel();
    };
  }, [enabled]);
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    latest.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const position = latest.current;
      if (!position || !target.current) return;
      setPoint({ x: position.x, y: position.y });
      const x = position.x / Math.max(1, position.width) - 0.5;
      const y = position.y / Math.max(1, position.height) - 0.5;
      const transform =
        kind === "preview"
          ? `perspective(1600px) translateY(-2px) rotateX(${-y * 0.7}deg) rotateY(${x * 0.7}deg)`
          : `translate(${x * 5}px, ${y * 4}px)`;
      animation.current?.cancel();
      animation.current = target.current.animate([{ transform }, { transform }], {
        duration: 1,
        fill: "forwards",
      });
    });
  };
  return { target, point: enabled ? point : null, onPointerMove, onPointerLeave: reset };
}
