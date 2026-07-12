import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "compact" | "standard" | "prominent";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  children: ReactNode;
  icon?: ReactNode;
  size?: ControlSize;
  variant?: ButtonVariant;
};

export function Button({
  busy = false,
  children,
  className = "",
  icon,
  size = "prominent",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      aria-busy={busy || undefined}
      className={`button button--${variant} button--${size} ${className}`.trim()}
      type={type}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="button__icon icon-slot">
          {icon}
        </span>
      ) : null}
      <span className="button__label">{children}</span>
    </button>
  );
}
