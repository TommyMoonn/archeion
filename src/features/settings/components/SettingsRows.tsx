import { type ReactNode, useId } from "react";

type SettingsRowFrameProps = {
  children: ReactNode;
  description?: ReactNode;
  label: string;
  note?: ReactNode;
  variant: "action" | "compact" | "feature" | "standard";
};

function SettingsRowFrame({ children, description, label, note, variant }: SettingsRowFrameProps) {
  const generatedId = useId();
  const labelId = `settings-row-label-${generatedId}`;
  const descriptionId = description ? `settings-row-description-${generatedId}` : undefined;
  const noteId = note ? `settings-row-note-${generatedId}` : undefined;
  const describedBy = [descriptionId, noteId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      aria-describedby={describedBy}
      aria-labelledby={labelId}
      className={`settings-row settings-row--${variant}`}
      role="group"
    >
      <div className="settings-row__meta">
        <strong id={labelId}>{label}</strong>
        {description ? (
          <span className="settings-row__description" id={descriptionId}>
            {description}
          </span>
        ) : null}
        {note ? (
          <span className="settings-row__note" id={noteId}>
            {note}
          </span>
        ) : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

type StandardSettingsRowProps = {
  children: ReactNode;
  description?: ReactNode;
  label: string;
  note?: ReactNode;
};

export function StandardSettingsRow(props: StandardSettingsRowProps) {
  return <SettingsRowFrame {...props} variant="standard" />;
}

type CompactSettingsRowProps = {
  children: ReactNode;
  label: string;
};

export function CompactSettingsRow(props: CompactSettingsRowProps) {
  return <SettingsRowFrame {...props} variant="compact" />;
}

type SettingsActionRowProps = {
  children: ReactNode;
  description?: ReactNode;
  label: string;
  note?: ReactNode;
};

export function SettingsActionRow(props: SettingsActionRowProps) {
  return <SettingsRowFrame {...props} variant="action" />;
}

type FeatureSettingsRowProps = {
  children: ReactNode;
  description?: ReactNode;
  label: string;
  note?: ReactNode;
};

export function FeatureSettingsRow(props: FeatureSettingsRowProps) {
  return <SettingsRowFrame {...props} variant="feature" />;
}

type SettingsSliderRowProps = {
  description: ReactNode;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
};

export function SettingsSliderRow({
  description,
  label,
  max,
  min,
  onChange,
  step,
  suffix = "",
  value,
}: SettingsSliderRowProps) {
  return (
    <FeatureSettingsRow description={description} label={label} note={`${value}${suffix}`}>
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
    </FeatureSettingsRow>
  );
}
