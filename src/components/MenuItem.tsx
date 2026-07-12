import type { ButtonHTMLAttributes, ReactNode } from "react";

type MenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  danger?: boolean;
  icon?: ReactNode;
};

export function MenuItem({
  children,
  className = "",
  danger = false,
  icon,
  type = "button",
  ...props
}: MenuItemProps) {
  return (
    <button
      className={`menu-item${danger ? " menu-item--danger" : ""}${icon ? "" : " menu-item--no-icon"} ${className}`.trim()}
      role="menuitem"
      type={type}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="menu-item__icon icon-slot">
          {icon}
        </span>
      ) : null}
      <span className="menu-item__label">{children}</span>
    </button>
  );
}
