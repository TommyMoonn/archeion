import { Minus, Plus } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { AppSelect } from "../../components/AppSelect";
import { readerTypefaceOptions } from "./readerFonts";
import { IconButton } from "../../components/IconButton";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { ReaderProgressPlacement, ReaderSettings } from "../../types/reader";
import type { ArchiveReaderThemeSelection } from "../../types/settings";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { ArchiveReaderThemeSelect } from "../themes/ArchiveReaderThemeSelect";
import { ReaderSidePanel } from "./ReaderSidePanel";

type ReaderSettingsPanelProps = {
  onClose: () => void;
  onReaderThemeCommit: (selection: ArchiveReaderThemeSelection) => void;
  onReaderThemeOpen: () => void;
  onSettingsCommit: (settings: ReaderSettings) => void;
  persistenceFailed: boolean;
  readerThemeCatalogError: string | null;
  readerThemeEntries: readonly ThemeCatalogEntry[];
  readerThemeSelection: ArchiveReaderThemeSelection | null;
  settings: ReaderSettings;
};

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

const readerModes = [
  { label: "Paged", value: "paged" },
  { label: "Continuous", value: "continuous" },
] as const;

function ReaderSetting({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const labelId = `reader-setting-label-${useId()}`;

  return (
    <div aria-labelledby={labelId} className={`reader-setting ${className}`.trim()} role="group">
      <span className="reader-setting__label" id={labelId}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function ReaderSettingsPanel({
  onClose,
  onReaderThemeCommit,
  onReaderThemeOpen,
  onSettingsCommit,
  persistenceFailed,
  readerThemeCatalogError,
  readerThemeEntries,
  readerThemeSelection,
  settings,
}: ReaderSettingsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  function update(changes: Partial<ReaderSettings>) {
    onSettingsCommit({ ...settings, ...changes });
  }

  return (
    <ReaderSidePanel
      accessibleLabel="Reader settings"
      className="reader-settings"
      closeButtonRef={closeButtonRef}
      closeLabel="Close reader settings"
      eyebrow="Reading"
      onClose={onClose}
      ref={panelRef}
      title="Appearance"
    >
      <div className="reader-settings__body">
        <ReaderSetting label="Reading mode">
          <SegmentedControl
            className="reader-control"
            label="Reader mode"
            onChange={(mode) => update({ mode })}
            options={[...readerModes]}
            size="standard"
            value={settings.mode}
          />
        </ReaderSetting>

        <ReaderSetting label="Reader theme">
          {readerThemeSelection ? (
            <ArchiveReaderThemeSelect
              entries={readerThemeEntries}
              fallback={settings.theme}
              onChange={onReaderThemeCommit}
              onOpen={onReaderThemeOpen}
              selection={readerThemeSelection}
            />
          ) : (
            <span className="reader-setting__unavailable">Unavailable</span>
          )}
        </ReaderSetting>

        <ReaderSetting label="Typeface">
          <AppSelect
            ariaLabel="Reader typeface"
            id="reader-font-family"
            onChange={(fontFamily) => update({ fontFamily })}
            options={readerTypefaceOptions}
            size="standard"
            value={settings.fontFamily}
          />
        </ReaderSetting>

        <ReaderSetting className="reader-setting--inline" label="Text size">
          <div className="reader-stepper">
            <IconButton
              disabled={settings.fontSize <= 14}
              label="Decrease text size"
              onClick={() => update({ fontSize: Math.max(14, settings.fontSize - 1) })}
              size="compact"
            >
              <Minus aria-hidden="true" />
            </IconButton>
            <output aria-live="polite">{settings.fontSize}px</output>
            <IconButton
              disabled={settings.fontSize >= 28}
              label="Increase text size"
              onClick={() => update({ fontSize: Math.min(28, settings.fontSize + 1) })}
              size="compact"
            >
              <Plus aria-hidden="true" />
            </IconButton>
          </div>
        </ReaderSetting>

        <ReaderSetting label="Line spacing">
          <SegmentedControl
            className="reader-control"
            label="Reader line spacing"
            onChange={(lineHeight) => update({ lineHeight: Number(lineHeight) })}
            options={lineHeights}
            size="standard"
            value={String(settings.lineHeight)}
          />
        </ReaderSetting>

        <ReaderSetting label="Page width">
          <SegmentedControl
            className="reader-control"
            label="Reader page width"
            onChange={(margin) => update({ margin: Number(margin) })}
            options={margins}
            size="standard"
            value={String(settings.margin)}
          />
        </ReaderSetting>

        <ReaderSetting label="Progress bar">
          <SegmentedControl
            className="reader-control"
            label="Reader progress bar placement"
            onChange={(progressPlacement) => update({ progressPlacement })}
            options={progressPlacements}
            size="standard"
            value={settings.progressPlacement}
          />
        </ReaderSetting>

        <p
          aria-live="polite"
          className="reader-settings__status"
          data-error={persistenceFailed || Boolean(readerThemeCatalogError) || undefined}
          role={persistenceFailed || readerThemeCatalogError ? "alert" : "status"}
        >
          {persistenceFailed
            ? "Settings could not be saved"
            : (readerThemeCatalogError ?? "Saved automatically")}
        </p>
      </div>
    </ReaderSidePanel>
  );
}
