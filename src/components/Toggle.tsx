type ToggleProps = {
  checked: boolean;
  className?: string;
  label: string;
  onChange: (checked: boolean) => void;
};

export function Toggle({ checked, className = "", label, onChange }: ToggleProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`toggle-control ${className}`.trim()}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}
