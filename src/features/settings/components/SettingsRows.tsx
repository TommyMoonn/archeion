import { type ReactNode, useId } from "react";
import { focusPresentationRuntime } from "@/app/inputModality";
import { Slider } from "@/components/ui/slider";

type SettingsRowFrameProps = {
  children: ReactNode;
  description?: ReactNode;
  label: string;
  note?: ReactNode;
  variant: "action" | "compact" | "feature" | "standard";
};

const rowDensity = {
  standard: "min-h-settings-row-standard py-settings-row-standard-inset",
  feature: "min-h-settings-row-standard py-settings-row-standard-inset",
  compact: "min-h-settings-row-compact py-settings-row-compact-inset",
  action: "min-h-settings-row-action py-settings-row-action-inset",
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
      className={`settings-row settings-row--${variant} grid settings-row-columns items-center gap-dialog-panel m-0 border-0 border-b border-solid border-line transition-colors [&_code]:block [&_code]:max-w-full [&_code]:text-muted [&_code]:font-mono [&_code]:text-code [&_code]:wrap-anywhere [&_code]:whitespace-normal duration-standard ease-standard settings-window-narrow:gap-overlay-viewport-inset settings-row-narrow:grid-cols-1 settings-row-narrow:items-start settings-row-narrow:gap-dialog-copy ${rowDensity[variant]}`}
      role="group"
    >
      <div className="settings-row__meta grid min-w-0 gap-settings-small-gap [&>span]:text-muted [&>span]:text-body-supporting [&>span]:not-italic [&>small]:text-muted [&>small]:text-body-supporting [&>small]:not-italic">
        <strong className="text-text text-control-label" id={labelId}>
          {label}
        </strong>
        {description ? (
          <span
            className="settings-row__description max-w-settings-description wrap-anywhere"
            id={descriptionId}
          >
            {description}
          </span>
        ) : null}
        {note ? (
          <span className="settings-row__note text-muted" id={noteId}>
            {note}
          </span>
        ) : null}
      </div>
      <div className="settings-row__control flex w-auto min-w-slider-row items-center justify-end settings-row-narrow:w-full settings-row-narrow:min-w-0 settings-row-narrow:flex-wrap settings-row-narrow:justify-stretch [&_.app-select]:settings-select-basis [&_.app-select]:w-slider-row [&_.app-select]:min-w-0 [&_.app-select]:max-w-full [&_.segmented-control]:settings-segment-min [&_.segmented-control]:max-w-full settings-row-narrow:[&_.app-select]:w-full settings-row-narrow:[&_.app-select]:basis-full settings-row-narrow:[&_.segmented-control]:w-full">
        {children}
      </div>
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
    <FeatureSettingsRow description={description} label={label}>
      <div className="settings-slider grid settings-slider-columns items-center gap-slider-gap w-slider-row max-w-full">
        <span
          aria-hidden="true"
          className="settings-slider__value text-text text-meta tabular-nums text-end whitespace-nowrap"
        >
          {value}
          {suffix}
        </span>
        <Slider
          label={label}
          valueText={`${value}${suffix}`}
          max={max}
          min={min}
          onValueChange={(next) => onChange(next)}
          onThumbKeyDown={(event) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(event.key)
            )
              focusPresentationRuntime.markKeyboardNavigation();
          }}
          step={step}
          largeStep={Math.max(step ?? 1, Math.round((max - min) / 10 / (step ?? 1)) * (step ?? 1))}
          value={value}
        />
      </div>
    </FeatureSettingsRow>
  );
}
