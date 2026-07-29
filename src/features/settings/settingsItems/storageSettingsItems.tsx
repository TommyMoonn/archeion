import { ArrowsClockwise, Broom } from "@phosphor-icons/react";

import { Button } from "../../../components/Button";
import { Toggle } from "../../../components/Toggle";
import { SettingsRow } from "../SettingsRow";
import type { SettingsItem } from "../settingsItemTypes";
import type { SettingsDialogController } from "../useSettingsDialogController";

const archiveScanUnavailableReason = "Wait for the archive scan to finish";

export const storageSettingsItems = [
  {
    description: "Checks the active archive when it opens.",
    groupLabel: "File monitoring",
    id: "storage.scan-on-startup",
    label: "Scan on startup",
    render: (context) => (
      <SettingsRow description="Checks the active archive when it opens." label="Scan on startup">
        <Toggle
          checked={context.files.scanOnStartup}
          label="Scan on startup"
          onChange={(scanOnStartup) => context.updateFiles({ scanOnStartup })}
        />
      </SettingsRow>
    ),
    searchTerms: ["monitoring", "scan", "startup", "files"],
    sectionId: "storage",
  },
  {
    description: "Refreshes the archive when files change on disk.",
    groupLabel: "File monitoring",
    id: "storage.live-filesystem-watcher",
    label: "Live filesystem watcher",
    render: (context) => (
      <SettingsRow
        description="Refreshes the archive when files change on disk."
        label="Live filesystem watcher"
      >
        <Toggle
          checked={context.files.liveWatcherEnabled}
          label="Live filesystem watcher"
          onChange={(liveWatcherEnabled) => context.updateFiles({ liveWatcherEnabled })}
        />
      </SettingsRow>
    ),
    searchTerms: ["monitoring", "live refresh", "filesystem", "watcher"],
    sectionId: "storage",
  },
  {
    description: "Checks the active archive without changing EPUB files.",
    groupLabel: "Archive scanning",
    groupStyle: "actions",
    id: "storage.rescan-archive",
    label: "Rescan archive",
    render: (context) => (
      <SettingsRow
        description="Checks the active archive without changing EPUB files."
        label="Rescan archive"
      >
        <Button
          disabled={context.archiveScanActive}
          disabledReason={archiveScanUnavailableReason}
          icon={<ArrowsClockwise aria-hidden="true" />}
          onClick={() => context.openConfirmation("rescanArchive")}
          variant="secondary"
        >
          Rescan archive
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["scanning", "rescan", "scan archive"],
    sectionId: "storage",
  },
  {
    description: "Forces EPUB files to be checked again later.",
    groupLabel: "Archive scanning",
    groupStyle: "actions",
    id: "storage.scanner-cache",
    label: "Clear scanner cache",
    render: (context) => (
      <SettingsRow
        description="Forces EPUB files to be checked again later."
        label="Clear scanner cache"
      >
        <Button onClick={() => context.openConfirmation("clearScannerCache")} variant="secondary">
          Clear scanner cache
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["scanning", "clear scanner cache", "scanner index"],
    sectionId: "storage",
  },
  {
    description: "Rebuilds parsed EPUB title and author data.",
    groupLabel: "Archive scanning",
    groupStyle: "actions",
    id: "storage.reextract-source-metadata",
    label: "Re-extract EPUB source metadata",
    render: (context) => (
      <SettingsRow
        description="Rebuilds parsed EPUB title and author data."
        label="Re-extract EPUB source metadata"
      >
        <Button
          disabled={context.archiveScanActive}
          disabledReason={archiveScanUnavailableReason}
          onClick={() => context.openConfirmation("reextractMetadata")}
          variant="secondary"
        >
          Re-extract source metadata
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["scanning", "source metadata", "re-extract", "epub metadata"],
    sectionId: "storage",
  },
  {
    deferredData: ["coverCacheStatus"],
    description: "Shows generated covers stored for this archive.",
    groupLabel: "Generated cover cache",
    groupStyle: "actions",
    id: "storage.cover-cache-status",
    label: "Cover cache status",
    render: (context) => (
      <SettingsRow
        description="Shows generated covers stored for this archive."
        label="Cover cache status"
        note={
          context.cache
            ? `${context.cache.fileCount} covers, ${formatBytes(context.cache.totalBytes)}`
            : "Unavailable"
        }
      >
        <Button
          icon={<Broom aria-hidden="true" />}
          onClick={() => context.openConfirmation("clearCoverCache")}
          variant="secondary"
        >
          Clear cover cache
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["generated cover cache", "cover cache status", "clear cover cache"],
    sectionId: "storage",
  },
  {
    description: "Keep one recovery copy after metadata edits. Off by default.",
    groupLabel: "EPUB writeback backups",
    groupStyle: "actions",
    id: "storage.keep-epub-writeback-backup",
    label: "Keep EPUB writeback backup",
    render: (context) => (
      <SettingsRow
        description="Keep one recovery copy after metadata edits. Off by default."
        label="Keep EPUB writeback backup"
      >
        <Toggle
          checked={context.files.keepEpubWritebackBackup}
          label="Keep EPUB writeback backup"
          onChange={(keepEpubWritebackBackup) => context.updateFiles({ keepEpubWritebackBackup })}
        />
      </SettingsRow>
    ),
    searchTerms: ["epub writeback backups", "epub backup", "metadata backup", "recovery copy"],
    sectionId: "storage",
  },
  {
    deferredData: ["epubWritebackBackupStatus"],
    description: "Remove saved recovery copies from successful metadata edits.",
    groupLabel: "EPUB writeback backups",
    groupStyle: "actions",
    id: "storage.clear-epub-writeback-backups",
    label: "Clear EPUB writeback backups",
    render: (context) => (
      <SettingsRow
        description="Remove saved recovery copies from successful metadata edits."
        label="Clear EPUB writeback backups"
        note={formatEpubWritebackBackupStatusNote(context)}
      >
        <Button
          disabled={
            context.epubWritebackBackupStatusState !== "loaded" ||
            !context.epubWritebackBackupStatus ||
            context.epubWritebackBackupStatus.fileCount === 0
          }
          onClick={() => context.openConfirmation("clearEpubWritebackBackups")}
          variant="secondary"
        >
          Clear backups
        </Button>
      </SettingsRow>
    ),
    searchTerms: [
      "epub writeback backups",
      "clear epub writeback backups",
      "backup cleanup",
      "metadata backup",
    ],
    sectionId: "storage",
  },
  {
    description: "Rebuilds corrupted sidecar files without changing EPUB files.",
    groupLabel: "Archive metadata and recovery",
    groupStyle: "actions",
    id: "storage.repair-metadata",
    label: "Repair archive metadata",
    render: (context) => (
      <SettingsRow
        description="Rebuilds corrupted sidecar files without changing EPUB files."
        label="Repair archive metadata"
      >
        <Button
          disabled={context.archiveScanActive}
          disabledReason={archiveScanUnavailableReason}
          onClick={() => context.openConfirmation("repairMetadata")}
          variant="secondary"
        >
          Repair metadata
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["sidecar metadata", "recovery", "repair", "corrupt", ".archeion"],
    sectionId: "storage",
  },
  {
    description: "Opens the active archive sidecar folder.",
    groupLabel: "Archive metadata and recovery",
    groupStyle: "actions",
    id: "storage.metadata-folder",
    label: "Reveal .archeion folder",
    render: (context) => (
      <SettingsRow
        description="Opens the active archive sidecar folder."
        label="Reveal .archeion folder"
      >
        <Button onClick={() => void context.revealMetadata()} variant="secondary">
          Reveal .archeion folder
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["sidecar metadata", "recovery", "metadata folder", ".archeion folder"],
    sectionId: "storage",
  },
  {
    description: "Restores file monitoring and backup retention preferences only.",
    groupLabel: "Reset",
    groupStyle: "actions",
    id: "storage.reset",
    label: "Reset storage preferences",
    render: (context) => (
      <SettingsRow
        description="Restores file monitoring and backup retention preferences only."
        label="Reset storage preferences"
      >
        <Button onClick={() => void context.resetStorage()} variant="secondary">
          Reset storage
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["reset storage preferences", "monitoring defaults", "backup retention"],
    sectionId: "storage",
  },
] as const satisfies readonly SettingsItem[];

function formatEpubWritebackBackupStatusNote(context: SettingsDialogController) {
  if (context.epubWritebackBackupStatusState !== "loaded") {
    return context.epubWritebackBackupStatusState === "unavailable"
      ? "Backup status unavailable."
      : "Checking backups...";
  }

  const status = context.epubWritebackBackupStatus;
  if (!status || status.fileCount === 0) return "0 backups";
  const backupLabel = status.fileCount === 1 ? "1 backup" : `${status.fileCount} backups`;
  return `${backupLabel}, ${formatBytes(status.totalBytes)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
