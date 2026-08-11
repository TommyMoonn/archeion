import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

type ReaderProgressPreview = Readonly<{
  chapterLabel?: string;
  percentage: number;
}>;

type ReaderProgressBarProps = {
  onSeek?: (percentage: number) => Promise<boolean>;
  percentage: number;
  placement: "top" | "side";
  resolveSeekPreview?: (percentage: number) => ReaderProgressPreview | null;
  seekable?: boolean;
};

const READER_PROGRESS_KEYBOARD_STEP = 1;

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function previewLabel(preview: ReaderProgressPreview): string {
  const percentage = `${Math.round(preview.percentage)}%`;
  return preview.chapterLabel ? `${percentage} · ${preview.chapterLabel}` : percentage;
}

function supportsHoverPreview(pointerType: string): boolean {
  return pointerType === "mouse" || pointerType === "pen";
}

export function ReaderProgressBar({
  onSeek,
  percentage,
  placement,
  resolveSeekPreview,
  seekable = false,
}: ReaderProgressBarProps) {
  const activePointerRef = useRef<number | null>(null);
  const hoverPointerRef = useRef(false);
  const focusPreviewRef = useRef<ReaderProgressPreview | null>(null);
  const focusOwnsPreviewRef = useRef(false);
  const previewRef = useRef<ReaderProgressPreview | null>(null);
  const [preview, setPreviewState] = useState<ReaderProgressPreview | null>(null);
  const currentPercentage = clampPercentage(percentage);
  const currentPreview = useMemo(
    () =>
      seekable
        ? (resolveSeekPreview?.(currentPercentage) ?? { percentage: currentPercentage })
        : null,
    [currentPercentage, resolveSeekPreview, seekable],
  );

  const setPreview = useCallback(
    (nextPercentage: number | null) => {
      if (nextPercentage === null || !seekable) {
        previewRef.current = null;
        setPreviewState(null);
        return null;
      }

      const normalized = clampPercentage(nextPercentage);
      const nextPreview = resolveSeekPreview?.(normalized) ?? { percentage: normalized };
      previewRef.current = nextPreview;
      setPreviewState(nextPreview);
      return nextPreview;
    },
    [resolveSeekPreview, seekable],
  );

  const restoreFocusPreview = useCallback(() => {
    if (focusOwnsPreviewRef.current && focusPreviewRef.current) {
      previewRef.current = focusPreviewRef.current;
      setPreviewState(focusPreviewRef.current);
      return;
    }

    setPreview(null);
  }, [setPreview]);

  const percentageFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const size = placement === "side" ? rect.height : rect.width;
      if (size <= 0) return currentPercentage;
      const offset = placement === "side" ? event.clientY - rect.top : event.clientX - rect.left;
      return clampPercentage((offset / size) * 100);
    },
    [currentPercentage, placement],
  );

  const commitSeek = useCallback(
    (targetPercentage: number) => {
      if (!seekable || !onSeek) return;
      const committedPercentage = clampPercentage(targetPercentage);
      const restoreCurrentPreview = () => {
        if (!focusOwnsPreviewRef.current) return;
        const restoredPreview = setPreview(currentPercentage);
        focusPreviewRef.current = restoredPreview;
      };
      void onSeek(committedPercentage).then((succeeded) => {
        if (!succeeded) restoreCurrentPreview();
      }, restoreCurrentPreview);
    },
    [currentPercentage, onSeek, seekable, setPreview],
  );

  const handleFocus = useCallback(() => {
    if (activePointerRef.current !== null) return;
    focusOwnsPreviewRef.current = true;
    focusPreviewRef.current = setPreview(currentPercentage);
  }, [currentPercentage, setPreview]);

  const handleBlur = useCallback(() => {
    focusOwnsPreviewRef.current = false;
    focusPreviewRef.current = null;
    if (activePointerRef.current === null && !hoverPointerRef.current) setPreview(null);
  }, [setPreview]);

  const handlePointerEnter = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!supportsHoverPreview(event.pointerType)) return;
      hoverPointerRef.current = true;
      if (activePointerRef.current === null) setPreview(percentageFromPointer(event));
    },
    [percentageFromPointer, setPreview],
  );

  const handlePointerLeave = useCallback(() => {
    hoverPointerRef.current = false;
    if (activePointerRef.current !== null) return;
    restoreFocusPreview();
  }, [restoreFocusPreview]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!seekable || !onSeek || event.button !== 0) return;
      event.preventDefault();
      activePointerRef.current = event.pointerId;
      if (supportsHoverPreview(event.pointerType)) hoverPointerRef.current = true;
      if (document.activeElement !== event.currentTarget) {
        event.currentTarget.focus({ preventScroll: true });
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setPreview(percentageFromPointer(event));
    },
    [onSeek, percentageFromPointer, seekable, setPreview],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current === event.pointerId) {
        event.preventDefault();
        setPreview(percentageFromPointer(event));
        return;
      }
      if (activePointerRef.current !== null || !supportsHoverPreview(event.pointerType)) return;
      hoverPointerRef.current = true;
      setPreview(percentageFromPointer(event));
    },
    [percentageFromPointer, setPreview],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      const targetPercentage = percentageFromPointer(event);
      activePointerRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
      if (hoverPointerRef.current || focusOwnsPreviewRef.current) {
        const finalPreview = setPreview(targetPercentage);
        if (focusOwnsPreviewRef.current) focusPreviewRef.current = finalPreview;
      } else {
        restoreFocusPreview();
      }
      commitSeek(targetPercentage);
    },
    [commitSeek, percentageFromPointer, restoreFocusPreview, setPreview],
  );

  const handlePointerCancel = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      activePointerRef.current = null;
      hoverPointerRef.current = false;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
      restoreFocusPreview();
    },
    [restoreFocusPreview],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!seekable || !onSeek) return;

      const basePercentage = previewRef.current?.percentage ?? currentPercentage;
      let targetPercentage: number;
      switch (event.key) {
        case "ArrowLeft":
          targetPercentage = basePercentage - READER_PROGRESS_KEYBOARD_STEP;
          break;
        case "ArrowRight":
          targetPercentage = basePercentage + READER_PROGRESS_KEYBOARD_STEP;
          break;
        case "ArrowUp":
          targetPercentage =
            basePercentage +
            (placement === "side" ? -READER_PROGRESS_KEYBOARD_STEP : READER_PROGRESS_KEYBOARD_STEP);
          break;
        case "ArrowDown":
          targetPercentage =
            basePercentage +
            (placement === "side" ? READER_PROGRESS_KEYBOARD_STEP : -READER_PROGRESS_KEYBOARD_STEP);
          break;
        case "Home":
          targetPercentage = 0;
          break;
        case "End":
          targetPercentage = 100;
          break;
        default:
          return;
      }

      event.preventDefault();
      event.stopPropagation();
      focusOwnsPreviewRef.current = true;
      const nextPreview = setPreview(targetPercentage);
      focusPreviewRef.current = nextPreview;
      if (nextPreview) commitSeek(nextPreview.percentage);
    },
    [commitSeek, currentPercentage, onSeek, placement, seekable, setPreview],
  );

  const visiblePreview = seekable ? preview : null;
  const accessiblePreview = visiblePreview ?? currentPreview;
  const valueText = accessiblePreview
    ? previewLabel(accessiblePreview)
    : `${Math.round(currentPercentage)}%`;
  const previewStyle = visiblePreview
    ? ({
        "--reader-progress-preview-position": `${visiblePreview.percentage}%`,
      } as CSSProperties)
    : undefined;

  return (
    <div
      aria-label="Reading progress"
      aria-orientation={seekable ? (placement === "side" ? "vertical" : "horizontal") : undefined}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(accessiblePreview?.percentage ?? currentPercentage)}
      aria-valuetext={seekable ? valueText : undefined}
      className="reader-progress"
      data-placement={placement}
      data-reader-ignore-shortcuts={seekable ? "" : undefined}
      data-seekable={seekable ? "" : undefined}
      onBlur={seekable ? handleBlur : undefined}
      onFocus={seekable ? handleFocus : undefined}
      onKeyDown={seekable ? handleKeyDown : undefined}
      onPointerCancel={seekable ? handlePointerCancel : undefined}
      onPointerDown={seekable ? handlePointerDown : undefined}
      onPointerEnter={seekable ? handlePointerEnter : undefined}
      onPointerLeave={seekable ? handlePointerLeave : undefined}
      onPointerMove={seekable ? handlePointerMove : undefined}
      onPointerUp={seekable ? handlePointerUp : undefined}
      role={seekable ? "slider" : "progressbar"}
      tabIndex={seekable ? 0 : undefined}
    >
      <span aria-hidden="true" className="reader-progress__track">
        <span
          className="reader-progress__fill"
          style={
            placement === "side"
              ? { height: `${currentPercentage}%` }
              : { width: `${currentPercentage}%` }
          }
        />
      </span>
      {visiblePreview ? (
        <>
          <span
            aria-hidden="true"
            className="reader-progress__handle"
            data-placement={placement}
            style={previewStyle}
          />
          <span
            aria-hidden="true"
            className="reader-progress__preview"
            data-placement={placement}
            style={previewStyle}
          >
            <strong>{Math.round(visiblePreview.percentage)}%</strong>
            {visiblePreview.chapterLabel ? <span>{visiblePreview.chapterLabel}</span> : null}
          </span>
        </>
      ) : null}
    </div>
  );
}
