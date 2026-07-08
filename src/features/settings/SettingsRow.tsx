import { type ReactNode } from "react";

type SettingsRowProps = {
  children: ReactNode;
  description?: ReactNode;
  label: string;
  note?: ReactNode;
};

export function SettingsRow({ children, description, label, note }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__meta">
        <strong>{label}</strong>
        {description ? (
          <span className="settings-row__description">{description}</span>
        ) : null}
        {note ? <span className="settings-row__note">{note}</span> : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

type SliderRowProps = {
  description?: ReactNode;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
};

export function SliderRow({
  description,
  label,
  max,
  min,
  onChange,
  step,
  suffix = "",
  value,
}: SliderRowProps) {
  return (
    <SettingsRow
      description={description}
      label={label}
      note={`${value}${suffix}`}
    >
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
    </SettingsRow>
  );
}
