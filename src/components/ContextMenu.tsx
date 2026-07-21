import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { MenuItem } from "./MenuItem";
import type {
  ContextMenuAnchor,
  ContextMenuController,
  ContextMenuInvocation,
} from "./contextMenuController";

export type ContextMenuAction = {
  className?: string;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  icon?: ReactNode;
  id: string;
  label: string;
  onSelect: () => void;
};

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
let activeMenu: { close: () => void; token: object } | null = null;

function enabledMenuItems(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(
    (item) => !item.disabled && item.getAttribute("aria-disabled") !== "true",
  );
}

function exactPosition(
  anchor: ContextMenuAnchor,
  menuRect: DOMRect,
): { left: number; top: number } {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const maximumLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - menuRect.width - VIEWPORT_MARGIN);
  const maximumTop = Math.max(VIEWPORT_MARGIN, viewportHeight - menuRect.height - VIEWPORT_MARGIN);

  let left: number;
  let top: number;

  if (anchor.type === "point") {
    left = anchor.x;
    top = anchor.y;

    if (top + menuRect.height > viewportHeight - VIEWPORT_MARGIN) {
      top = anchor.y - menuRect.height;
    }
  } else {
    const anchorRect = anchor.element.getBoundingClientRect();
    left = anchorRect.left;
    top = anchorRect.bottom + ANCHOR_GAP;

    if (top + menuRect.height > viewportHeight - VIEWPORT_MARGIN) {
      top = anchorRect.top - menuRect.height - ANCHOR_GAP;
    }
  }

  return {
    left: Math.min(Math.max(left, VIEWPORT_MARGIN), maximumLeft),
    top: Math.min(Math.max(top, VIEWPORT_MARGIN), maximumTop),
  };
}

type ContextMenuTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-expanded" | "aria-haspopup" | "children" | "onClick"
> & {
  children: ReactNode;
  controller: ContextMenuController;
  disabledReason?: string;
  label: string;
};

export const ContextMenuTrigger = forwardRef<HTMLButtonElement, ContextMenuTriggerProps>(
  function ContextMenuTrigger(
    {
      children,
      className = "",
      controller,
      disabled,
      disabledReason,
      label,
      onKeyDown,
      title,
      type = "button",
      ...props
    },
    ref,
  ) {
    const reasonId = useId();
    const localRef = useRef<HTMLButtonElement | null>(null);

    function assignRef(element: HTMLButtonElement | null) {
      localRef.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    }

    function openFromTrigger(focusTarget: ContextMenuInvocation["focusTarget"] = null) {
      const trigger = localRef.current;
      if (!trigger || disabled) return;
      controller.openAtElement(trigger, {
        focusTarget,
        restoreFocusTo: trigger,
        triggerElement: trigger,
      });
    }

    function handleClick(event: ReactMouseEvent<HTMLButtonElement>) {
      event.stopPropagation();
      if (disabled) {
        event.preventDefault();
        return;
      }
      if (controller.isOpen) {
        controller.close({ restoreFocus: false });
        return;
      }
      openFromTrigger(event.detail === 0 ? "first" : null);
    }

    function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
      onKeyDown?.(event);
      if (event.defaultPrevented || disabled) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        openFromTrigger(event.key === "ArrowDown" ? "first" : "last");
      }
    }

    const hasDisabledReason = Boolean(disabled && disabledReason);

    return (
      <>
        <button
          aria-describedby={hasDisabledReason ? reasonId : undefined}
          aria-disabled={disabled || undefined}
          aria-expanded={controller.isOpen}
          aria-haspopup="menu"
          aria-label={label}
          className={`menu-trigger ${className}`.trim()}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          ref={assignRef}
          title={hasDisabledReason ? disabledReason : (title ?? label)}
          type={type}
          {...props}
        >
          {children}
        </button>
        {hasDisabledReason ? (
          <span className="sr-only" id={reasonId}>
            {disabledReason}
          </span>
        ) : null}
      </>
    );
  },
);

type ContextMenuSurfaceProps = {
  actions: ContextMenuAction[];
  ariaLabel: string;
  className?: string;
  controller: ContextMenuController;
  dismissKey?: string;
};

export function ContextMenuSurface({
  actions,
  ariaLabel,
  className = "",
  controller,
  dismissKey,
}: ContextMenuSurfaceProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTokenRef = useRef<object>({});
  const focusedInvocationRef = useRef<ContextMenuInvocation | null>(null);
  const previousDismissKeyRef = useRef(dismissKey);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const invocation = controller.invocation;

  const reposition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu || !invocation) return;
    const next = exactPosition(invocation.anchor, menu.getBoundingClientRect());
    setPosition((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
  }, [invocation]);

  useLayoutEffect(() => {
    if (!invocation) return;
    reposition();

    const menu = menuRef.current;
    if (!menu) return;
    if (focusedInvocationRef.current !== invocation) {
      focusedInvocationRef.current = invocation;
      const items = enabledMenuItems(menu);
      const target = invocation.focusTarget === "last" ? items.at(-1) : items[0];
      if (invocation.focusTarget) target?.focus();
    }
  });

  useEffect(() => {
    if (!invocation) return;

    const currentInvocation = invocation;
    const token = menuTokenRef.current;
    if (activeMenu && activeMenu.token !== token) activeMenu.close();
    activeMenu = { close: controller.close, token };

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      if (currentInvocation.triggerElement?.contains(target)) return;
      controller.close();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const menu = menuRef.current;
      if (!menu) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        controller.close({ restoreFocus: true });
        return;
      }

      const items = enabledMenuItems(menu);
      if (items.length === 0) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !menu.contains(target)) return;

      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
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
        return;
      }

      if (
        (event.key === "Enter" || event.key === " ") &&
        items.includes(target as HTMLButtonElement)
      ) {
        event.preventDefault();
        event.stopPropagation();
        (target as HTMLButtonElement).click();
      }
    }

    function closeWithoutFocus() {
      controller.close();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", closeWithoutFocus, true);
    window.addEventListener("blur", closeWithoutFocus);
    window.addEventListener("resize", closeWithoutFocus);
    window.addEventListener("popstate", closeWithoutFocus);
    window.addEventListener("hashchange", closeWithoutFocus);

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => reposition());
    if (menuRef.current) resizeObserver?.observe(menuRef.current);

    return () => {
      if (activeMenu?.token === token) activeMenu = null;
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", closeWithoutFocus, true);
      window.removeEventListener("blur", closeWithoutFocus);
      window.removeEventListener("resize", closeWithoutFocus);
      window.removeEventListener("popstate", closeWithoutFocus);
      window.removeEventListener("hashchange", closeWithoutFocus);
      resizeObserver?.disconnect();
    };
  }, [controller, invocation, reposition]);

  useEffect(() => {
    if (previousDismissKeyRef.current !== dismissKey) {
      previousDismissKeyRef.current = dismissKey;
      if (invocation) controller.close();
    }
  }, [controller, dismissKey, invocation]);

  if (!invocation || typeof document === "undefined") return null;

  const style = {
    "--context-menu-left": `${position.left}px`,
    "--context-menu-top": `${position.top}px`,
  } as CSSProperties;

  return createPortal(
    <div
      aria-label={ariaLabel}
      className={`context-menu menu-popover ${className}`.trim()}
      ref={menuRef}
      role="menu"
      style={style}
    >
      {actions.map((action) => (
        <MenuItem
          className={action.className}
          danger={action.danger}
          disabled={action.disabled}
          disabledReason={action.disabledReason}
          icon={action.icon}
          key={action.id}
          onClick={() => controller.runAction(action.onSelect)}
        >
          {action.label}
        </MenuItem>
      ))}
    </div>,
    document.body,
  );
}
