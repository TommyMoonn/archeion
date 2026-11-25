import { ContextMenuItem } from "./ui/context-menu";
import { DropdownMenuItem } from "./ui/dropdown-menu";
import { cn } from "@/utils/cn";
import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";

type ActionListButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "role"> & {
  children: ReactNode;
  danger?: boolean;
  disabledReason?: string;
  icon?: ReactNode;
};

type StyledActionButtonProps = ActionListButtonProps & {
  primitive?: "point" | "element";
  role?: "menuitem";
};

function StyledActionButton({
  children,
  className = "",
  danger = false,
  disabled = false,
  disabledReason,
  icon,
  onClick,
  title,
  type = "button",
  role,
  primitive,
  ...props
}: StyledActionButtonProps) {
  const reasonId = useId();
  const hasDisabledReason = disabled && Boolean(disabledReason);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  }

  const content = (
    <>
      {icon ? (
        <span aria-hidden="true" className="menu-item__icon icon-slot">
          {icon}
        </span>
      ) : null}
      <span
        data-slot="menu-item-label"
        className="menu-item__label min-w-0 wrap-anywhere whitespace-normal"
      >
        {children}
      </span>
    </>
  );
  const buttonClassName = cn(
    "menu-item grid min-w-0 items-center gap-control-gap w-full min-h-control-compact px-input-gap py-menu-item-block border-0 rounded-small text-text bg-transparent text-meta font-medium text-start wrap-anywhere cursor-pointer hover:not-disabled:text-text-strong hover:not-disabled:bg-surface-hover focus-visible:text-text-strong focus-visible:bg-surface-hover focus-visible:-outline-offset-2 aria-selected:text-text-strong aria-selected:bg-surface-raised control-active:text-text-strong control-active:bg-action-neutral-active",
    icon ? "menu-item-columns" : "menu-item--no-icon grid-cols-1",
    danger && "menu-item--danger text-danger-strong",
    className,
  );
  const button = (
    <button
      aria-describedby={hasDisabledReason ? reasonId : undefined}
      aria-disabled={hasDisabledReason || undefined}
      className={buttonClassName}
      disabled={disabled && !hasDisabledReason}
      onClick={handleClick}
      role={role}
      type={type}
      title={title}
      {...props}
    >
      {content}
    </button>
  );
  // Base UI disabled items stay focusable. Only explained disabled actions should do so.
  const Item = primitive === "point" ? ContextMenuItem : DropdownMenuItem;
  return (
    <>
      {primitive && (!disabled || hasDisabledReason) ? (
        <Item nativeButton closeOnClick={false} disabled={disabled} render={button} />
      ) : (
        button
      )}
      {hasDisabledReason ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}

export function ActionListButton(props: ActionListButtonProps) {
  return <StyledActionButton {...props} />;
}

export function MenuItem(props: ActionListButtonProps) {
  return <StyledActionButton {...props} role="menuitem" />;
}

export function PrimitiveMenuItem({ point, ...props }: ActionListButtonProps & { point: boolean }) {
  return <StyledActionButton {...props} role="menuitem" primitive={point ? "point" : "element"} />;
}
