import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  icon?: ReactNode;
  variant?: ButtonVariant;
};

export function Button({
  children,
  className = "",
  icon,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button className={`button button--${variant} ${className}`.trim()} type={type} {...props}>
      {icon ? (
        <span aria-hidden="true" className="button__icon icon-slot">
          {icon}
        </span>
      ) : null}
      <span className="button__label">{children}</span>
    </button>
  );
}
