import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "compact" | "standard" | "prominent";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  children: ReactNode;
  disabledReason?: string;
  icon?: ReactNode;
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
  size = "prominent",
  title,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const generatedId = useId();
  const hasExplainedDisabledState = disabled && Boolean(disabledReason);
  const reasonId = hasExplainedDisabledState ? `button-reason-${generatedId}` : undefined;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  }

  return (
    <>
      <button
        aria-busy={busy || undefined}
        aria-describedby={reasonId}
        aria-disabled={hasExplainedDisabledState || undefined}
        className={`button button--${variant} button--${size} ${className}`.trim()}
        disabled={disabled && !hasExplainedDisabledState}
        onClick={handleClick}
        title={hasExplainedDisabledState ? disabledReason : title}
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
      {reasonId ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
