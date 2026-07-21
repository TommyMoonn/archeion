import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";

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
  disabledReason,
  icon,
  title,
  type = "button",
  ...props
}: MenuItemProps) {
  const reasonId = useId();
  const hasDisabledReason = Boolean(props.disabled && disabledReason);

  return (
    <>
      <button
        aria-describedby={hasDisabledReason ? reasonId : undefined}
        className={`menu-item${danger ? " menu-item--danger" : ""}${icon ? "" : " menu-item--no-icon"} ${className}`.trim()}
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
