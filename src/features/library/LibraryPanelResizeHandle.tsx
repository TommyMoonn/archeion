import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Tooltip } from "../../components/Tooltip";

type LibraryPanelResizeHandleProps = {
  label: string;
  tooltip?: string;
  className: string;
  edge: "start" | "end";
  minWidth: number;
  maxWidth: number;
  width: number;
  onWidthChange?: (width: number) => void;
  onWidthCommit?: (width: number) => void;
};

export function LibraryPanelResizeHandle({
  label,
  tooltip,
  className,
  edge,
  minWidth,
  maxWidth,
  width,
  onWidthChange,
  onWidthCommit,
}: LibraryPanelResizeHandleProps) {
  const [resizing, setResizing] = useState(false);
  const resizePointerRef = useRef<{
    pointerId: number;
    startClientX: number;
    startWidth: number;
    rtl: boolean;
  } | null>(null);
  const resizeWidthRef = useRef(width);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeWidthRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    },
    [],
  );
  const updateResizeWidth = (nextWidth: number) => {
    const clamped = Math.round(Math.min(maxWidth, Math.max(minWidth, nextWidth)));
    resizeWidthRef.current = clamped;
    onWidthChange?.(clamped);
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !onWidthChange || resizePointerRef.current) return;
    event.preventDefault();
    if (!event.currentTarget.parentElement) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    resizePointerRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: width,
      rtl,
    };
    resizeWidthRef.current = width;
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = resizePointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pendingResizeWidthRef.current =
      pointer.startWidth +
      (pointer.rtl !== (edge === "start") ? -1 : 1) * (event.clientX - pointer.startClientX);
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const pendingWidth = pendingResizeWidthRef.current;
      pendingResizeWidthRef.current = null;
      if (pendingWidth !== null) updateResizeWidth(pendingWidth);
    });
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = resizePointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    const pendingWidth = pendingResizeWidthRef.current;
    pendingResizeWidthRef.current = null;
    if (pendingWidth !== null) updateResizeWidth(pendingWidth);
    resizePointerRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onWidthCommit?.(resizeWidthRef.current);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onWidthChange) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = event.shiftKey ? 24 : 8;
    let nextWidth: number | null = null;
    if (event.key === "Home") nextWidth = minWidth;
    else if (event.key === "End") nextWidth = maxWidth;
    else if (event.key === "ArrowRight")
      nextWidth = width + (rtl !== (edge === "start") ? -step : step);
    else if (event.key === "ArrowLeft")
      nextWidth = width + (rtl !== (edge === "start") ? step : -step);
    if (nextWidth === null) return;
    event.preventDefault();
    updateResizeWidth(nextWidth);
    onWidthCommit?.(Math.round(Math.min(maxWidth, Math.max(minWidth, nextWidth))));
  };

  return (
    <Tooltip content={tooltip ?? label} placement={edge === "end" ? "right" : "left"}>
      <div
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemax={maxWidth}
        aria-valuemin={minWidth}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels`}
        className={className}
        data-resizing={resizing || undefined}
        role="separator"
        tabIndex={0}
        onKeyDown={handleResizeKeyDown}
        onLostPointerCapture={finishResize}
        onPointerCancel={finishResize}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={finishResize}
      />
    </Tooltip>
  );
}
