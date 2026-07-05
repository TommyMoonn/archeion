import {
  Minus,
  Plus,
  X,
} from "@phosphor-icons/react";

import { IconButton } from "../../components/IconButton";
import type {
  ReaderFlowMode,
  ReaderSettings,
  ReaderTheme,
} from "../../types/reader";

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
  { label: "Tight", value: 1.4 },
  { label: "Normal", value: 1.6 },
  { label: "Relaxed", value: 1.8 },
  { label: "Airy", value: 2 },
];

const margins = [
  { label: "Narrow", value: 24 },
  { label: "Medium", value: 48 },
  { label: "Wide", value: 72 },
];

const flowModes: Array<{ label: string; value: ReaderFlowMode }> = [
  { label: "Pages", value: "paginated" },
  { label: "Scroll", value: "scrolled" },
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
        <div className="reader-segments reader-segments--themes">
          {themes.map((theme) => (
            <button
              aria-pressed={settings.theme === theme.value}
              data-theme-option={theme.value}
              key={theme.value}
              onClick={() => update({ theme: theme.value })}
              type="button"
            >
              <span aria-hidden="true" />
              {theme.label}
            </button>
          ))}
        </div>
      </div>

      <div className="reader-setting">
        <label className="reader-setting__label" htmlFor="reader-font-family">
          Typeface
        </label>
        <select
          id="reader-font-family"
          value={settings.fontFamily}
          onChange={(event) => update({ fontFamily: event.currentTarget.value })}
        >
          <option value="serif">Book serif</option>
          <option value="sans">Clean sans</option>
          <option value="system">System</option>
        </select>
      </div>

      <div className="reader-setting reader-setting--inline">
        <span className="reader-setting__label">Text size</span>
        <div className="reader-stepper">
          <IconButton
            disabled={settings.fontSize <= 14}
            label="Decrease text size"
            onClick={() =>
              update({ fontSize: Math.max(14, settings.fontSize - 1) })
            }
          >
            <Minus aria-hidden="true" size={16} />
          </IconButton>
          <output aria-live="polite">{settings.fontSize}px</output>
          <IconButton
            disabled={settings.fontSize >= 28}
            label="Increase text size"
            onClick={() =>
              update({ fontSize: Math.min(28, settings.fontSize + 1) })
            }
          >
            <Plus aria-hidden="true" size={16} />
          </IconButton>
        </div>
      </div>

      <div className="reader-setting">
        <span className="reader-setting__label">Line spacing</span>
        <div className="reader-segments">
          {lineHeights.map((option) => (
            <button
              aria-pressed={settings.lineHeight === option.value}
              key={option.value}
              onClick={() => update({ lineHeight: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="reader-setting">
        <span className="reader-setting__label">Page width</span>
        <div className="reader-segments">
          {margins.map((option) => (
            <button
              aria-pressed={settings.margin === option.value}
              key={option.value}
              onClick={() => update({ margin: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="reader-setting">
        <span className="reader-setting__label">Flow</span>
        <div className="reader-segments">
          {flowModes.map((option) => (
            <button
              aria-pressed={settings.flowMode === option.value}
              key={option.value}
              onClick={() => update({ flowMode: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p
        className="reader-settings__status"
        data-error={persistenceFailed || undefined}
      >
        {persistenceFailed
          ? "Settings could not be saved"
          : "Changes save automatically"}
      </p>
    </aside>
  );
}
