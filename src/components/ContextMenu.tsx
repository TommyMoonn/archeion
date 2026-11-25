import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { focusPresentationRuntime } from "../app/inputModality";
import { PrimitiveMenuItem } from "./MenuItem";
import { DropdownMenu, DropdownMenuContent } from "./ui/dropdown-menu";
import { ContextMenu, ContextMenuContent } from "./ui/context-menu";
import { cn } from "@/utils/cn";
import { Tooltip, type TooltipPlacement } from "./Tooltip";
import { useOwnedTooltipAvailable } from "./tooltipStore";
import {
  isTopmostTransientSurface,
  useTransientSurfaceOwnership,
} from "../utils/transientSurfaceOwnership";
import type { ContextMenuController, ContextMenuInvocation } from "./contextMenuController";

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

const menuTriggerClassName =
  "menu-trigger inline-grid size-control-compact place-items-center p-0 border-standard border-solid border-transparent rounded-control text-muted bg-transparent cursor-pointer list-none transition-select hover:border-line-strong hover:text-text-strong hover:bg-surface-hover control-active:border-line-strong control-active:text-text-strong control-active:bg-action-neutral-active";

let activeMenu: { close: () => void; token: object } | null = null;

function navigableMenuItems(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(
    (item) => !item.disabled,
  );
}

function isActivatableMenuItem(item: HTMLButtonElement): boolean {
  return !item.disabled && item.getAttribute("aria-disabled") !== "true";
}

type ContextMenuTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-expanded" | "aria-haspopup" | "children" | "onClick"
> & {
  children: ReactNode;
  controller: ContextMenuController;
  disabledReason?: string;
  label: string;
  tooltip?: string;
  tooltipPlacement?: TooltipPlacement;
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
      tooltip,
      tooltipPlacement,
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
        focusPresentationRuntime.markKeyboardNavigation();
        openFromTrigger(event.key === "ArrowDown" ? "first" : "last");
      }
    }

    const hasDisabledReason = Boolean(disabled && disabledReason);
    const ownedTooltipAvailable = useOwnedTooltipAvailable();
    const tooltipText = hasDisabledReason ? disabledReason : (tooltip ?? title ?? label);
    const usesOwnedDisabledDescription = Boolean(
      ownedTooltipAvailable && hasDisabledReason && tooltipText,
    );
    const button = (
      <button
        aria-describedby={hasDisabledReason && !usesOwnedDisabledDescription ? reasonId : undefined}
        aria-disabled={hasDisabledReason || undefined}
        aria-expanded={controller.isOpen}
        aria-haspopup="menu"
        aria-label={label}
        data-slot="action-menu-trigger"
        className={cn(menuTriggerClassName, className)}
        disabled={Boolean(disabled) && !hasDisabledReason}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        ref={assignRef}
        title={tooltipText ? undefined : title}
        type={type}
        {...props}
      >
        {children}
      </button>
    );
    const trigger = ownedTooltipAvailable ? (
      <Tooltip content={tooltipText ?? ""} placement={tooltipPlacement}>
        {button}
      </Tooltip>
    ) : (
      button
    );

    return (
      <>
        {trigger}
        {hasDisabledReason && !usesOwnedDisabledDescription ? (
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
  const [menuElement, setMenuElement] = useState<HTMLDivElement | null>(null);
  const invocation = controller.invocation;

  const anchor = useMemo(() => {
    if (!invocation) return undefined;
    if (invocation.anchor.type === "element") return invocation.anchor.element;
    const { x, y } = invocation.anchor;
    return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
  }, [invocation]);

  const assignMenu = useCallback((element: HTMLDivElement | null) => {
    menuRef.current = element;
    setMenuElement(element);
  }, []);

  useLayoutEffect(() => {
    if (!invocation || !menuElement || focusedInvocationRef.current === invocation) return;
    focusedInvocationRef.current = invocation;
    const items = navigableMenuItems(menuElement);
    const target = invocation.focusTarget === "last" ? items.at(-1) : items[0];
    if (invocation.focusTarget) target?.focus();
    else menuElement.focus({ preventScroll: true });
  }, [invocation, menuElement]);

  useTransientSurfaceOwnership({
    active: invocation !== null && menuElement !== null,
    closeOnModalOpen: true,
    dismissOnOutsidePointer: true,
    elementRef: menuRef,
    kind: "context-menu",
    onDismiss: (reason) => {
      controller.close({ restoreFocus: reason === "escape" });
    },
    origin: invocation?.restoreFocusTo ?? null,
    trigger: invocation?.triggerElement ?? null,
  });

  useLayoutEffect(() => {
    if (!invocation || !menuElement) return;

    const currentInvocation = invocation;
    const token = menuTokenRef.current;
    if (activeMenu && activeMenu.token !== token) activeMenu.close();
    activeMenu = { close: controller.close, token };

    function ownKeyboardEvent(event: KeyboardEvent, preventDefault = true) {
      if (preventDefault) event.preventDefault();
      event.stopImmediatePropagation();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (activeMenu?.token !== token) return;
      const menu = menuRef.current;
      if (!menu || !isTopmostTransientSurface(menu)) return;

      if (event.key === "Tab") {
        focusPresentationRuntime.markKeyboardNavigation();
        event.stopImmediatePropagation();
        controller.close({ restoreFocus: true });
        return;
      }

      const items = navigableMenuItems(menu);
      const target = event.target;
      const targetItem =
        target instanceof HTMLButtonElement && menu.contains(target) && items.includes(target)
          ? target
          : null;

      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        ownKeyboardEvent(event);
        if (items.length === 0) return;

        focusPresentationRuntime.markKeyboardNavigation();
        const currentIndex = targetItem ? items.indexOf(targetItem) : -1;
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? currentIndex < 0
                  ? 0
                  : (currentIndex + 1) % items.length
                : currentIndex < 0
                  ? items.length - 1
                  : (currentIndex <= 0 ? items.length : currentIndex) - 1;
        items[nextIndex]?.focus();
        return;
      }

      if ((event.key === "Enter" || event.key === " ") && targetItem) {
        ownKeyboardEvent(event);
        focusPresentationRuntime.markKeyboardNavigation();
        if (isActivatableMenuItem(targetItem)) targetItem.click();
        return;
      }

      ownKeyboardEvent(event, event.key !== "Tab");
    }

    function closeWithoutFocus() {
      controller.close();
    }

    function handleScroll(event: Event) {
      const menu = menuRef.current;
      const target = event.target;
      if (target instanceof Node && menu?.contains(target)) return;

      if (currentInvocation.anchor.type === "point") {
        closeWithoutFocus();
        return;
      }

      if (target === document || target === window) {
        closeWithoutFocus();
        return;
      }

      if (target instanceof Element && target.contains(currentInvocation.anchor.element)) {
        closeWithoutFocus();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", closeWithoutFocus);
    window.addEventListener("popstate", closeWithoutFocus);
    window.addEventListener("hashchange", closeWithoutFocus);

    return () => {
      if (activeMenu?.token === token) activeMenu = null;
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", closeWithoutFocus);
      window.removeEventListener("popstate", closeWithoutFocus);
      window.removeEventListener("hashchange", closeWithoutFocus);
    };
  }, [controller, invocation, menuElement]);

  useEffect(() => {
    if (previousDismissKeyRef.current !== dismissKey) {
      previousDismissKeyRef.current = dismissKey;
      if (invocation) controller.close();
    }
  }, [controller, dismissKey, invocation]);

  if (!invocation || typeof document === "undefined") return null;

  const point = invocation.anchor.type === "point";
  const Root = point ? ContextMenu : DropdownMenu;
  const Content = point ? ContextMenuContent : DropdownMenuContent;
  const origin =
    invocation.anchor.type === "element" ? invocation.anchor.element : invocation.restoreFocusTo;
  const container = origin?.closest<HTMLElement>("dialog[open], .reader-page, .reader-status-page");
  // The existing controller owns dismissal and focus restoration for external invocations.
  return (
    <Root
      open
      modal={false}
      highlightItemOnHover={false}
      onOpenChange={(_, details) => details.cancel()}
    >
      <Content
        anchor={anchor}
        container={container ?? undefined}
        aria-label={ariaLabel}
        className={className}
        ref={assignMenu}
      >
        {actions.map((action) => (
          <PrimitiveMenuItem
            point={point}
            className={action.className}
            danger={action.danger}
            disabled={action.disabled}
            disabledReason={action.disabledReason}
            icon={action.icon}
            key={action.id}
            onClick={() => controller.runAction(action.onSelect)}
          >
            {action.label}
          </PrimitiveMenuItem>
        ))}
      </Content>
    </Root>
  );
}
