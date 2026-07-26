import { forwardRef, useId } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ControlSize } from "./Button";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  disabledReason?: string;
  label: string;
  size?: ControlSize;
  tooltip?: boolean;
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
    tooltip = false,
    type = "button",
    "aria-describedby": ariaDescribedBy,
    ...props
  },
  ref,
) {
  const reasonId = useId();
  const tooltipId = useId();
  const hasAccessibleDisabledReason = Boolean(disabled && disabledReason);
  const tooltipText = disabled && disabledReason ? disabledReason : (title ?? label);
  const ownedDescriptionId = tooltip ? tooltipId : hasAccessibleDisabledReason ? reasonId : null;
  const descriptionIds = [ariaDescribedBy, ownedDescriptionId].filter(Boolean).join(" ");
  const button = (
    <button
      aria-describedby={descriptionIds || undefined}
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={[
        "icon-button",
        `icon-button--${size}`,
        tooltip ? "icon-button--has-tooltip" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
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
      title={tooltip ? undefined : tooltipText}
      type={type}
      {...props}
    >
      <span aria-hidden="true" className="icon-slot">
        {children}
      </span>
    </button>
  );

  if (tooltip) {
    return (
      <span className="icon-button-tooltip-anchor">
        {button}
        <span className="icon-button__tooltip" id={tooltipId} role="tooltip">
          {tooltipText}
        </span>
      </span>
    );
  }

  return (
    <>
      {button}
      {hasAccessibleDisabledReason && !tooltip ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
});
