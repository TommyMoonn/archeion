import { Minus, Plus, X } from "@phosphor-icons/react";

import { AppSelect } from "../../components/AppSelect";
import { readerTypefaceOptions } from "./readerFonts";
import { IconButton } from "../../components/IconButton";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { ReaderProgressPlacement, ReaderSettings, ReaderTheme } from "../../types/reader";

type ReaderSettingsPanelProps = {
  onChange: (settings: ReaderSettings) => void;
  onClose: () => void;
  persistenceFailed: boolean;
  settings: ReaderSettings;
};

const themes: Array<{ label: string; value: ReaderTheme }> = [
  { label: "Light", value: "light" },
  { label: "Sepia", value: "sepia" },
  { label: "Dark", value: "dark" },
];

const lineHeights = [
  { label: "Tight", value: "1.4" },
  { label: "Normal", value: "1.6" },
  { label: "Relaxed", value: "1.8" },
  { label: "Airy", value: "2" },
];

const margins = [
  { label: "Narrow", value: "24" },
  { label: "Medium", value: "48" },
  { label: "Wide", value: "72" },
];

const progressPlacements: Array<{
  label: string;
  value: ReaderProgressPlacement;
}> = [
  { label: "Top", value: "top" },
  { label: "Side", value: "side" },
];

export function ReaderSettingsPanel({
  onChange,
  onClose,
  persistenceFailed,
  settings,
}: ReaderSettingsPanelProps) {
  function update(changes: Partial<ReaderSettings>) {
    onChange({ ...settings, ...changes });
  }

  return (
    <aside
      aria-label="Reader settings"
      className="reader-settings"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="reader-settings__header">
        <div>
          <p>Reading</p>
          <h2>Appearance</h2>
        </div>
        <IconButton label="Close reader settings" onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </IconButton>
      </header>

      <div className="reader-setting">
        <span className="reader-setting__label">Theme</span>
        <SegmentedControl
          className="reader-control reader-control--themes"
          label="Reader theme"
          onChange={(theme) => update({ theme })}
          options={themes.map((theme) => ({
            ...theme,
            icon: (
              <span
                aria-hidden="true"
                className="reader-theme-swatch"
                data-theme-option={theme.value}
              />
            ),
          }))}
          value={settings.theme}
        />
      </div>

      <div className="reader-setting">
        <span className="reader-setting__label">Typeface</span>
        <AppSelect
          ariaLabel="Reader typeface"
          id="reader-font-family"
          onChange={(fontFamily) => update({ fontFamily })}
          options={readerTypefaceOptions}
          value={settings.fontFamily}
        />
      </div>

      <div className="reader-setting reader-setting--inline">
        <span className="reader-setting__label">Text size</span>
        <div className="reader-stepper">
          <IconButton
            disabled={settings.fontSize <= 14}
            label="Decrease text size"
            onClick={() => update({ fontSize: Math.max(14, settings.fontSize - 1) })}
          >
            <Minus aria-hidden="true" size={16} />
          </IconButton>
          <output aria-live="polite">{settings.fontSize}px</output>
          <IconButton
            disabled={settings.fontSize >= 28}
            label="Increase text size"
            onClick={() => update({ fontSize: Math.min(28, settings.fontSize + 1) })}
          >
            <Plus aria-hidden="true" size={16} />
          </IconButton>
        </div>
      </div>

      <div className="reader-setting">
        <span className="reader-setting__label">Line spacing</span>
        <SegmentedControl
          className="reader-control"
          label="Reader line spacing"
          onChange={(lineHeight) => update({ lineHeight: Number(lineHeight) })}
          options={lineHeights}
          value={String(settings.lineHeight)}
        />
      </div>

      <div className="reader-setting">
        <span className="reader-setting__label">Page width</span>
        <SegmentedControl
          className="reader-control"
          label="Reader page width"
          onChange={(margin) => update({ margin: Number(margin) })}
          options={margins}
          value={String(settings.margin)}
        />
      </div>

      <div className="reader-setting">
        <span className="reader-setting__label">Progress bar</span>
        <SegmentedControl
          className="reader-control"
          label="Reader progress bar placement"
          onChange={(progressPlacement) => update({ progressPlacement })}
          options={progressPlacements}
          value={settings.progressPlacement}
        />
      </div>

      <p className="reader-settings__status" data-error={persistenceFailed || undefined}>
        {persistenceFailed ? "Settings could not be saved" : "Saved automatically"}
      </p>
    </aside>
  );
}
