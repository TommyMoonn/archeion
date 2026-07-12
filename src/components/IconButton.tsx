import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ControlSize } from "./Button";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  disabledReason?: string;
  label: string;
  size?: ControlSize;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    children,
    className = "",
    disabled,
    disabledReason,
    label,
    size = "standard",
    title,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      aria-label={label}
      className={`icon-button icon-button--${size} ${className}`.trim()}
      disabled={disabled}
      ref={ref}
      title={disabled && disabledReason ? disabledReason : (title ?? label)}
      type={type}
      {...props}
    >
      <span aria-hidden="true" className="icon-slot">
        {children}
      </span>
    </button>
  );
});
