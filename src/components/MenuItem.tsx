import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";

type MenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  danger?: boolean;
  disabledReason?: string;
  icon?: ReactNode;
};

export function MenuItem({
  children,
  className = "",
  danger = false,
  disabled = false,
  disabledReason,
  icon,
  onClick,
  title,
  type = "button",
  ...props
}: MenuItemProps) {
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

  return (
    <>
      <button
        aria-describedby={hasDisabledReason ? reasonId : undefined}
        aria-disabled={hasDisabledReason || undefined}
        className={`menu-item${danger ? " menu-item--danger" : ""}${icon ? "" : " menu-item--no-icon"} ${className}`.trim()}
        disabled={disabled && !hasDisabledReason}
        onClick={handleClick}
        role="menuitem"
        type={type}
        title={hasDisabledReason ? disabledReason : title}
        {...props}
      >
        {icon ? (
          <span aria-hidden="true" className="menu-item__icon icon-slot">
            {icon}
          </span>
        ) : null}
        <span className="menu-item__label">{children}</span>
      </button>
      {hasDisabledReason ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
