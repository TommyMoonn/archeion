import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Tooltip } from "./Tooltip";
import { useOwnedTooltipAvailable } from "./tooltipStore";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "compact" | "standard" | "prominent";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  // Pass false while idle to reserve the same slot used during work.
  busy?: boolean;
  // For standalone actions only. Omit when the feature already owns a live status.
  busyStatus?: string;
  children: ReactNode;
  disabledReason?: string;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  size?: ControlSize;
  variant?: ButtonVariant;
};

export function Button({
  busy,
  busyStatus,
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
    if (disabled || busy) {
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
      aria-disabled={(!busy && hasExplainedDisabledState) || undefined}
      className={`button button--${variant} button--${size} ${className}`.trim()}
      disabled={busy || (disabled && !hasExplainedDisabledState)}
      onClick={handleClick}
      ref={ref}
      title={hasExplainedDisabledState ? undefined : title}
      type={type}
      {...props}
    >
      {icon || busy !== undefined ? (
        <span aria-hidden="true" className="button__icon icon-slot">
          {icon}
          {busy ? <BusyIndicator /> : null}
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
      {busyStatus ? (
        <span className="sr-only" role="status">
          {busy ? busyStatus : ""}
        </span>
      ) : null}
      {reasonId && !usesOwnedDisabledDescription ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}

// Presentation only. The caller retains operation and live-status ownership.
function BusyIndicator() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const reveal = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(reveal);
  }, []);
  return <span className="button__busy" data-visible={visible || undefined} />;
}
