import { forwardRef, useId } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ControlSize } from "./Button";
import { Tooltip, type TooltipPlacement } from "./Tooltip";
import { useOwnedTooltipAvailable } from "./tooltipStore";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  disabledReason?: string;
  label: string;
  size?: ControlSize;
  tooltip?: string;
  tooltipPlacement?: TooltipPlacement;
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
    tooltip,
    tooltipPlacement,
    type = "button",
    "aria-describedby": ariaDescribedBy,
    ...props
  },
  ref,
) {
  const reasonId = useId();
  const hasAccessibleDisabledReason = Boolean(disabled && disabledReason);
  const ownedTooltipAvailable = useOwnedTooltipAvailable();
  const tooltipText = hasAccessibleDisabledReason ? disabledReason : tooltip;
  const usesOwnedDisabledDescription = Boolean(
    ownedTooltipAvailable && hasAccessibleDisabledReason && tooltipText,
  );
  const descriptionIds = [
    ariaDescribedBy,
    hasAccessibleDisabledReason && !usesOwnedDisabledDescription ? reasonId : null,
  ]
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
      title={tooltipText ? undefined : title}
      type={type}
      {...props}
    >
      <span aria-hidden="true" className="icon-slot">
        {children}
      </span>
    </button>
  );

  const control = ownedTooltipAvailable ? (
    <Tooltip content={tooltipText ?? ""} placement={tooltipPlacement}>
      {button}
    </Tooltip>
  ) : (
    button
  );

  return (
    <>
      {control}
      {hasAccessibleDisabledReason && !usesOwnedDisabledDescription ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
});
