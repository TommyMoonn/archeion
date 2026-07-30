import {
  Children,
  cloneElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  resolveTooltipPosition,
  type TooltipPlacement,
  type TooltipPosition,
} from "./tooltipPosition";
import { createTooltipStore, TooltipContext } from "./tooltipStore";

export type { TooltipPlacement } from "./tooltipPosition";

export const TOOLTIP_POINTER_OPEN_DELAY_MS = 500;
export const TOOLTIP_FOCUS_OPEN_DELAY_MS = 250;

type TooltipProviderProps = {
  children: ReactNode;
  subscribeToRouteChanges?: (listener: () => void) => () => void;
};

type TooltipProps = {
  children: ReactElement;
  content: string;
  onlyWhenTruncated?: boolean | string;
  placement?: TooltipPlacement;
};

type TooltipTriggerProps = {
  "aria-describedby"?: string;
  onBlur?: FocusEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
};
const subscribeToNothing = () => () => undefined;
const getFalseSnapshot = () => false;

function mergeDescriptionIds(current: string | undefined, tooltipId: string): string {
  return [current, tooltipId].filter(Boolean).join(" ");
}

function pointerCanOpenTooltip(event: ReactPointerEvent<HTMLElement>): boolean {
  if (event.pointerType && event.pointerType !== "mouse") return false;
  return !window.matchMedia?.("(pointer: coarse)").matches;
}

function keyboardFocusCanOpenTooltip(element: HTMLElement): boolean {
  return element.ownerDocument.documentElement.dataset.inputModality === "keyboard";
}

function tooltipTargetIsTruncated(
  trigger: HTMLElement,
  onlyWhenTruncated: boolean | string | undefined,
): boolean {
  if (!onlyWhenTruncated) return true;
  const target =
    typeof onlyWhenTruncated === "string"
      ? trigger.querySelector<HTMLElement>(onlyWhenTruncated)
      : trigger;
  return Boolean(
    target &&
    (target.scrollWidth > target.clientWidth || target.scrollHeight > target.clientHeight),
  );
}

export function TooltipProvider({ children, subscribeToRouteChanges }: TooltipProviderProps) {
  const [store] = useState(createTooltipStore);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") store.dismiss();
    };
    const handleViewportChange = () => store.dismiss();

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
      store.clear();
    };
  }, [store]);

  useEffect(
    () => subscribeToRouteChanges?.(() => store.dismiss()),
    [store, subscribeToRouteChanges],
  );

  return <TooltipContext.Provider value={store}>{children}</TooltipContext.Provider>;
}

export function Tooltip({ children, content, onlyWhenTruncated, placement = "top" }: TooltipProps) {
  const context = useContext(TooltipContext);
  const generatedId = useId();
  const tooltipId = `app-tooltip-${generatedId.replaceAll(":", "")}`;
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const child = Children.only(children) as ReactElement<TooltipTriggerProps>;
  const active = useSyncExternalStore(
    context?.subscribe ?? subscribeToNothing,
    context ? () => context.getActiveId() === tooltipId : getFalseSnapshot,
    getFalseSnapshot,
  );
  const dismiss = context?.dismiss;

  useLayoutEffect(() => {
    if (!active || !triggerRef.current || !tooltipRef.current) {
      setPosition(null);
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    setPosition(
      resolveTooltipPosition({
        preferredPlacement: placement,
        tooltipHeight: tooltipRect.height,
        tooltipWidth: tooltipRect.width,
        triggerRect,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      }),
    );
  }, [active, content, placement]);

  useEffect(
    () => () => {
      dismiss?.(tooltipId);
    },
    [dismiss, tooltipId],
  );

  useEffect(() => {
    if (!content) dismiss?.(tooltipId);
  }, [content, dismiss, tooltipId]);

  if (!context || !content) return child;

  const childProps = child.props;
  // cloneElement preserves the child's opaque ref; Tooltip never reads it during render.
  // eslint-disable-next-line react-hooks/refs
  const trigger = cloneElement(child, {
    "aria-describedby": mergeDescriptionIds(childProps["aria-describedby"], tooltipId),
    onBlur: (event) => {
      childProps.onBlur?.(event);
      context.dismiss(tooltipId);
    },
    onFocus: (event) => {
      childProps.onFocus?.(event);
      triggerRef.current = event.currentTarget;
      if (
        keyboardFocusCanOpenTooltip(event.currentTarget) &&
        tooltipTargetIsTruncated(event.currentTarget, onlyWhenTruncated)
      ) {
        context.schedule(tooltipId, TOOLTIP_FOCUS_OPEN_DELAY_MS);
      }
    },
    onKeyDown: (event) => {
      childProps.onKeyDown?.(event);
      if (event.key === "Escape") context.dismiss(tooltipId);
    },
    onPointerDown: (event) => {
      childProps.onPointerDown?.(event);
      context.dismiss(tooltipId);
    },
    onPointerEnter: (event) => {
      childProps.onPointerEnter?.(event);
      triggerRef.current = event.currentTarget;
      if (
        pointerCanOpenTooltip(event) &&
        tooltipTargetIsTruncated(event.currentTarget, onlyWhenTruncated)
      ) {
        context.schedule(tooltipId, TOOLTIP_POINTER_OPEN_DELAY_MS);
      }
    },
    onPointerLeave: (event) => {
      childProps.onPointerLeave?.(event);
      context.dismiss(tooltipId);
    },
  });

  return (
    <>
      {trigger}
      {typeof document !== "undefined"
        ? createPortal(
            active ? (
              <div
                className="app-tooltip"
                data-placement={position?.placement ?? placement}
                data-positioned={position ? "true" : undefined}
                ref={tooltipRef}
                role="tooltip"
                id={tooltipId}
                style={{
                  left: position?.left ?? 0,
                  top: position?.top ?? 0,
                  visibility: position ? "visible" : "hidden",
                }}
              >
                {content}
              </div>
            ) : (
              <span className="sr-only" id={tooltipId} role="tooltip">
                {content}
              </span>
            ),
            document.body,
          )
        : null}
    </>
  );
}
