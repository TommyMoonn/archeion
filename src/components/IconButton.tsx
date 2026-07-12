import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  label: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, className = "", label, type = "button", ...props },
  ref,
) {
  return (
    <button
      aria-label={label}
      className={`icon-button ${className}`.trim()}
      ref={ref}
      title={label}
      type={type}
      {...props}
    >
      <span aria-hidden="true" className="icon-slot">
        {children}
      </span>
    </button>
  );
});
