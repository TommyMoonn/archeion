import { ArrowsClockwise, Broom } from "@phosphor-icons/react";

import { Button } from "../../../components/Button";
import { Toggle } from "../../../components/Toggle";
import type { CoverCacheStatus } from "../../../storage/LibraryStorage";
import type { FilesAndMetadataSettings } from "../../../types/settings";
import { SettingsRow } from "../SettingsRow";

type StorageSettingsSectionProps = {
  cache: CoverCacheStatus | null;
  files: FilesAndMetadataSettings;
  hidden: boolean;
  onClearCoverCache: () => void;
  onClearScannerCache: () => void;
  onLiveWatcherEnabledChange: (value: boolean) => void;
  onReextractMetadata: () => void;
  onRescan: () => void;
  onReset: () => void;
  onRevealMetadataFolder: () => void;
  onScanOnStartupChange: (value: boolean) => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StorageSettingsSection({
  cache,
  files,
  hidden,
  onClearCoverCache,
  onClearScannerCache,
  onLiveWatcherEnabledChange,
  onReextractMetadata,
  onRescan,
  onReset,
  onRevealMetadataFolder,
  onScanOnStartupChange,
}: StorageSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Storage</h2>
      </header>
      <div className="settings-section__group">
        <h3>Scan preferences</h3>
        <SettingsRow
          description="Checks the active archive when it opens."
          label="Scan on startup"
        >
          <Toggle
            checked={files.scanOnStartup}
            label="Scan on startup"
            onChange={onScanOnStartupChange}
          />
        </SettingsRow>
        <SettingsRow
          description="Refreshes the archive when files change on disk."
          label="Live filesystem watcher"
        >
          <Toggle
            checked={files.liveWatcherEnabled}
            label="Live filesystem watcher"
            onChange={onLiveWatcherEnabledChange}
          />
        </SettingsRow>
      </div>

      <div className="settings-section__group settings-section__group--actions">
        <h3>Archive maintenance</h3>
        <SettingsRow
          description="Checks the active archive without changing EPUB files."
          label="Rescan archive"
        >
          <Button
            icon={<ArrowsClockwise aria-hidden="true" size={17} />}
            onClick={onRescan}
            variant="secondary"
          >
            Rescan archive
          </Button>
        </SettingsRow>
        <SettingsRow
          description="Forces EPUB files to be checked again later."
          label="Scanner cache"
        >
          <Button onClick={onClearScannerCache} variant="secondary">
            Clear scanner cache
          </Button>
        </SettingsRow>
        <SettingsRow
          description="Rebuilds parsed EPUB title and author data."
          label="Re-extract EPUB source metadata"
        >
          <Button onClick={onReextractMetadata} variant="secondary">
            Re-extract source metadata
          </Button>
        </SettingsRow>
        <SettingsRow
          description="Shows extracted covers stored for this archive."
          label="Cover cache status"
          note={
            cache
              ? `${cache.fileCount} covers, ${formatBytes(cache.totalBytes)}`
              : "Unavailable"
          }
        >
          <Button
            icon={<Broom aria-hidden="true" size={17} />}
            onClick={onClearCoverCache}
            variant="secondary"
          >
            Clear cover cache
          </Button>
        </SettingsRow>
        <SettingsRow
          description="Opens the active archive metadata folder."
          label=".archeion folder"
        >
          <Button onClick={onRevealMetadataFolder} variant="secondary">
            Reveal .archeion folder
          </Button>
        </SettingsRow>
      </div>

      <div className="settings-section__group settings-section__group--actions">
        <h3>Reset</h3>
        <SettingsRow label="Reset storage settings">
          <Button onClick={onReset} variant="secondary">
            Reset
          </Button>
        </SettingsRow>
      </div>
    </section>
  );
}
