import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from "react";
import { Tooltip } from "./Tooltip";
import { useOwnedTooltipAvailable } from "./tooltipStore";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "compact" | "standard" | "prominent";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  children: ReactNode;
  disabledReason?: string;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  size?: ControlSize;
  variant?: ButtonVariant;
};

export function Button({
  busy = false,
  children,
  className = "",
  disabled = false,
  disabledReason,
  icon,
  onClick,
  ref,
  size = "prominent",
  title,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const generatedId = useId();
  const hasExplainedDisabledState = disabled && Boolean(disabledReason);
  const reasonId = hasExplainedDisabledState ? `button-reason-${generatedId}` : undefined;
  const ownedTooltipAvailable = useOwnedTooltipAvailable();
  const usesOwnedDisabledDescription = Boolean(ownedTooltipAvailable && hasExplainedDisabledState);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  }

  const button = (
    <button
      aria-busy={busy || undefined}
      aria-describedby={!usesOwnedDisabledDescription ? reasonId : undefined}
      aria-disabled={hasExplainedDisabledState || undefined}
      className={`button button--${variant} button--${size} ${className}`.trim()}
      disabled={disabled && !hasExplainedDisabledState}
      onClick={handleClick}
      ref={ref}
      title={hasExplainedDisabledState ? undefined : title}
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
  const control = ownedTooltipAvailable ? (
    <Tooltip content={hasExplainedDisabledState ? (disabledReason ?? "") : ""}>{button}</Tooltip>
  ) : (
    button
  );

  return (
    <>
      {control}
      {reasonId && !usesOwnedDisabledDescription ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
