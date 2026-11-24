import { useId } from "react";
import type { ControlSize } from "./Button";
import { Switch } from "./ui/switch";
import { Tooltip } from "./Tooltip";
import { useOwnedTooltipAvailable } from "./tooltipStore";

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
  const ownedTooltipAvailable = useOwnedTooltipAvailable();
  const usesOwnedDisabledDescription = Boolean(ownedTooltipAvailable && hasExplainedDisabledState);
  const button = (
    <Switch
      aria-describedby={!usesOwnedDisabledDescription ? reasonId : undefined}
      aria-disabled={hasExplainedDisabledState || undefined}
      aria-label={label}
      checked={checked}
      className={className}
      disabled={disabled && !hasExplainedDisabledState}
      readOnly={hasExplainedDisabledState}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onCheckedChange={(next) => onChange(next)}
      size={size}
    />
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
