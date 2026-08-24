import { Button } from "../../../components/Button";
import { Toggle } from "../../../components/Toggle";
import { SettingsActionRow, StandardSettingsRow } from "../components/SettingsRows";
import type { SettingsItem } from "../settingsItemTypes";
import type { SettingsController } from "../useSettingsController";

const archiveScanUnavailableReason = "Wait for the archive scan to finish";

export const storageSettingsItems = [
  {
    description: "Checks the active archive when it opens.",
    groupLabel: "Global policies",
    id: "storage.scan-on-startup",
    label: "Scan on startup",
    render: (context) => (
      <StandardSettingsRow
        description="Checks the active archive when it opens."
        label="Scan on startup"
      >
        <Toggle
          checked={context.files.scanOnStartup}
          label="Scan on startup"
          onChange={(scanOnStartup) => context.updateFiles({ scanOnStartup })}
        />
      </StandardSettingsRow>
    ),
    searchTerms: ["monitoring", "scan", "startup", "files"],
    sectionId: "storage",
  },
  {
    description: "Refreshes the archive when files change on disk.",
    groupLabel: "Global policies",
    id: "storage.live-filesystem-watcher",
    label: "Live filesystem watcher",
    render: (context) => (
      <StandardSettingsRow
        description="Refreshes the archive when files change on disk."
        label="Live filesystem watcher"
      >
        <Toggle
          checked={context.files.liveWatcherEnabled}
          label="Live filesystem watcher"
          onChange={(liveWatcherEnabled) => context.updateFiles({ liveWatcherEnabled })}
        />
      </StandardSettingsRow>
    ),
    searchTerms: ["monitoring", "live refresh", "filesystem", "watcher"],
    sectionId: "storage",
  },
  {
    description: "Keep one recovery copy after metadata edits. Off by default.",
    groupLabel: "Global policies",
    id: "storage.keep-epub-writeback-backup",
    label: "Keep EPUB writeback backup",
    render: (context) => (
      <StandardSettingsRow
        description="Keep one recovery copy after metadata edits. Off by default."
        label="Keep EPUB writeback backup"
      >
        <Toggle
          checked={context.files.keepEpubWritebackBackup}
          label="Keep EPUB writeback backup"
          onChange={(keepEpubWritebackBackup) => context.updateFiles({ keepEpubWritebackBackup })}
        />
      </StandardSettingsRow>
    ),
    searchTerms: ["epub writeback backups", "epub backup", "metadata backup", "recovery copy"],
    sectionId: "storage",
  },
  {
    description: "Restores file monitoring and backup retention preferences only.",
    groupLabel: "Global policies",
    groupStyle: "actions",
    id: "storage.reset",
    label: "Storage preferences",
    render: (context) => (
      <SettingsActionRow
        description="Restores file monitoring and backup retention preferences only."
        label="Storage preferences"
      >
        <Button onClick={() => void context.resetStorage()} variant="secondary">
          Reset
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["reset storage preferences", "monitoring defaults", "backup retention"],
    sectionId: "storage",
  },
  {
    description: "Checks the active archive without changing EPUB files.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.rescan-archive",
    label: "Archive scan",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="Checks the active archive without changing EPUB files."
        label="Archive scan"
      >
        <Button
          disabled={context.archiveScanActive}
          disabledReason={archiveScanUnavailableReason}
          onClick={() => context.openConfirmation("rescanArchive")}
          variant="secondary"
        >
          Run
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["scanning", "rescan", "scan archive"],
    sectionId: "storage",
  },
  {
    description: "Forces EPUB files to be checked again later.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.scanner-cache",
    label: "Scanner cache",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="Forces EPUB files to be checked again later."
        label="Scanner cache"
      >
        <Button onClick={() => context.openConfirmation("clearScannerCache")} variant="secondary">
          Clear
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["scanning", "clear scanner cache", "scanner index"],
    sectionId: "storage",
  },
  {
    description: "Rebuilds parsed EPUB title and author data.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.reextract-source-metadata",
    label: "Source metadata",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="Rebuilds parsed EPUB title and author data."
        label="Source metadata"
      >
        <Button
          disabled={context.archiveScanActive}
          disabledReason={archiveScanUnavailableReason}
          onClick={() => context.openConfirmation("reextractMetadata")}
          variant="secondary"
        >
          Re-extract
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["scanning", "source metadata", "re-extract", "epub metadata"],
    sectionId: "storage",
  },
  {
    deferredData: ["coverCacheStatus"],
    description: "Generated covers stored for the active archive.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.cover-cache-status",
    label: "Generated cover cache",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="Generated covers stored for the active archive."
        label="Generated cover cache"
        note={
          context.cache
            ? `${context.cache.fileCount} covers, ${formatBytes(context.cache.totalBytes)}`
            : "Unavailable"
        }
      >
        <Button onClick={() => context.openConfirmation("clearCoverCache")} variant="secondary">
          Clear
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["generated cover cache", "cover cache status", "clear cover cache"],
    sectionId: "storage",
  },
  {
    deferredData: ["epubWritebackBackupStatus"],
    description: "Recovery copies from successful metadata edits.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.clear-epub-writeback-backups",
    label: "EPUB writeback backups",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="Recovery copies from successful metadata edits."
        label="EPUB writeback backups"
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
          Clear
        </Button>
      </SettingsActionRow>
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
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.repair-metadata",
    label: "Archive metadata",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="Rebuilds corrupted sidecar files without changing EPUB files."
        label="Archive metadata"
      >
        <Button
          disabled={context.archiveScanActive}
          disabledReason={archiveScanUnavailableReason}
          onClick={() => context.openConfirmation("repairMetadata")}
          variant="secondary"
        >
          Repair
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["sidecar metadata", "recovery", "repair", "corrupt", ".archeion"],
    sectionId: "storage",
  },
  {
    description: "The active archive's .archeion sidecar files.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.metadata-folder",
    label: "Metadata folder",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="The active archive's .archeion sidecar files."
        label="Metadata folder"
      >
        <Button onClick={() => void context.revealMetadata()} variant="secondary">
          Open
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["sidecar metadata", "recovery", "metadata folder", ".archeion folder"],
    sectionId: "storage",
  },
] as const satisfies readonly SettingsItem[];

function formatEpubWritebackBackupStatusNote(context: SettingsController) {
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
