import { forwardRef, useId } from "react";
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
    onClick,
    size = "standard",
    title,
    type = "button",
    "aria-describedby": ariaDescribedBy,
    ...props
  },
  ref,
) {
  const reasonId = useId();
  const hasAccessibleDisabledReason = Boolean(disabled && disabledReason);
  const tooltipText = disabled && disabledReason ? disabledReason : (title ?? label);
  const descriptionIds = [ariaDescribedBy, hasAccessibleDisabledReason ? reasonId : null]
    .filter(Boolean)
    .join(" ");
  const button = (
    <button
      aria-describedby={descriptionIds || undefined}
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={["icon-button", `icon-button--${size}`, className].filter(Boolean).join(" ")}
      disabled={disabled && !hasAccessibleDisabledReason}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
      ref={ref}
      title={tooltipText}
      type={type}
      {...props}
    >
      <span aria-hidden="true" className="icon-slot">
        {children}
      </span>
    </button>
  );

  return (
    <>
      {button}
      {hasAccessibleDisabledReason ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
});
