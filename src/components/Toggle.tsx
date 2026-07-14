import { useId } from "react";
import type { ControlSize } from "./Button";

type ToggleProps = {
  checked: boolean;
  className?: string;
  disabled?: boolean;
  disabledReason?: string;
  label: string;
  onChange: (checked: boolean) => void;
  size?: Exclude<ControlSize, "prominent">;
};

export function Toggle({
  checked,
  className = "",
  disabled = false,
  disabledReason,
  label,
  onChange,
  size = "standard",
}: ToggleProps) {
  const generatedId = useId();
  const hasExplainedDisabledState = disabled && Boolean(disabledReason);
  const reasonId = hasExplainedDisabledState ? `toggle-reason-${generatedId}` : undefined;

  return (
    <>
      <button
        aria-checked={checked}
        aria-describedby={reasonId}
        aria-disabled={hasExplainedDisabledState || undefined}
        aria-label={label}
        className={`toggle-control toggle-control--${size} ${className}`.trim()}
        disabled={disabled && !hasExplainedDisabledState}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onChange(!checked);
        }}
        role="switch"
        title={hasExplainedDisabledState ? disabledReason : undefined}
        type="button"
      >
        <span aria-hidden="true" />
      </button>
      {reasonId ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
