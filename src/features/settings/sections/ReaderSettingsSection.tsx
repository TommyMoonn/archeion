import { AppSelect } from "../../../components/AppSelect";
import { Button } from "../../../components/Button";
import { SegmentedControl } from "../../../components/SegmentedControl";
import type { ReaderSettings } from "../../../types/reader";
import { SettingsRow, SliderRow } from "../SettingsRow";
import {
  progressPlacementOptions,
  readerThemeOptions,
  typefaceOptions,
} from "../settingsOptions";

type ReaderSettingsSectionProps = {
  hidden: boolean;
  onChange: (changes: Partial<ReaderSettings>) => void;
  onReset: () => void;
  reader: ReaderSettings;
};

export function ReaderSettingsSection({
  hidden,
  onChange,
  onReset,
  reader,
}: ReaderSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Reader</h2>
      </header>
      <SettingsRow
        description="Sets the default reader typeface."
        label="Font family"
      >
        <AppSelect
          ariaLabel="Reader font family"
          onChange={(fontFamily) => onChange({ fontFamily })}
          options={typefaceOptions}
          value={reader.fontFamily}
        />
      </SettingsRow>
      <SliderRow
        description="Sets the default text size in the reader."
        label="Font size"
        max={28}
        min={14}
        onChange={(fontSize) => onChange({ fontSize })}
        suffix="px"
        value={reader.fontSize}
      />
      <SliderRow
        description="Adjusts spacing between lines in the reader."
        label="Line height"
        max={2}
        min={1.4}
        onChange={(lineHeight) => onChange({ lineHeight })}
        step={0.1}
        value={Number(reader.lineHeight.toFixed(1))}
      />
      <SliderRow
        description="Adjusts page padding inside the reader."
        label="Page margin"
        max={72}
        min={24}
        onChange={(margin) => onChange({ margin })}
        step={8}
        suffix="px"
        value={reader.margin}
      />
      <SettingsRow
        description="Applies inside the EPUB reader."
        label="Reader theme"
      >
        <SegmentedControl
          label="Reader theme"
          onChange={(theme) => onChange({ theme })}
          options={readerThemeOptions}
          value={reader.theme}
        />
      </SettingsRow>
      <SettingsRow
        description="Chooses where reading progress appears."
        label="Progress placement"
      >
        <SegmentedControl
          label="Reader progress placement"
          onChange={(progressPlacement) => onChange({ progressPlacement })}
          options={progressPlacementOptions}
          value={reader.progressPlacement}
        />
      </SettingsRow>
      <SettingsRow label="Reset reader settings">
        <Button onClick={onReset} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    </section>
  );
}
