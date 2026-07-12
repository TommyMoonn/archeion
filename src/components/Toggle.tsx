import type { ControlSize } from "./Button";

type ToggleProps = {
  checked: boolean;
  className?: string;
  label: string;
  onChange: (checked: boolean) => void;
  size?: Exclude<ControlSize, "prominent">;
};

export function Toggle({
  checked,
  className = "",
  label,
  onChange,
  size = "standard",
}: ToggleProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`toggle-control toggle-control--${size} ${className}`.trim()}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}
