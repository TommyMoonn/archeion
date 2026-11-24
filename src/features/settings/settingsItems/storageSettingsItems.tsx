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
    description: "Review exact and probable duplicate EPUBs in the Library.",
    groupLabel: "Archive maintenance",
    id: "storage.find-duplicates",
    label: "Duplicate EPUBs",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="Review exact and probable duplicate EPUBs in the Library."
        label="Duplicate EPUBs"
      >
        <Button
          disabled={context.archiveScanActive || context.integrityNavigationBusy}
          disabledReason={
            context.archiveScanActive ? archiveScanUnavailableReason : "Opening archive diagnostics"
          }
          onClick={() => void context.openIntegrityResults("duplicates")}
          variant="secondary"
        >
          Find duplicates
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["find duplicates", "duplicate books", "archive integrity"],
    sectionId: "storage",
  },
  {
    description: "Inspect EPUB problems in the Library.",
    groupLabel: "Archive maintenance",
    id: "storage.check-epub-issues",
    label: "EPUB issues",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow description="Inspect EPUB problems in the Library." label="EPUB issues">
        <Button
          disabled={context.archiveScanActive || context.integrityNavigationBusy}
          disabledReason={
            context.archiveScanActive ? archiveScanUnavailableReason : "Opening archive diagnostics"
          }
          onClick={() => void context.openIntegrityResults("epub-issues")}
          variant="secondary"
        >
          Check EPUB issues
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["check epub issues", "epub diagnostics", "archive integrity"],
    sectionId: "storage",
  },
  {
    description: "Save bookmarks, highlights, and notes from the active archive.",
    groupLabel: "Archive maintenance",
    id: "storage.export-annotations",
    label: "Export annotations",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="Save bookmarks, highlights, and notes from the active archive."
        label="Export annotations"
      >
        <div className="settings-annotation-export-actions">
          <Button
            disabled={context.annotationExportBusy}
            disabledReason="An annotation export is in progress"
            onClick={() => void context.exportAnnotations("json")}
            variant="secondary"
          >
            Export JSON
          </Button>
          <Button
            disabled={context.annotationExportBusy}
            disabledReason="An annotation export is in progress"
            onClick={() => void context.exportAnnotations("markdown")}
            variant="secondary"
          >
            Export Markdown
          </Button>
        </div>
      </SettingsActionRow>
    ),
    searchTerms: ["bookmarks", "highlights", "notes", "markdown", "json"],
    sectionId: "storage",
  },
  {
    description: "Review annotations from an Archeion JSON export before importing.",
    groupLabel: "Archive maintenance",
    id: "storage.import-annotations",
    label: "Import annotations",
    requiresArchive: true,
    render: (context) => (
      <SettingsActionRow
        description="Review annotations from an Archeion JSON export before importing."
        label="Import annotations"
      >
        <Button
          aria-haspopup="dialog"
          disabled={context.annotationImportBusy}
          disabledReason="An annotation import is in progress"
          onClick={() => void context.previewAnnotationImport()}
          variant="secondary"
        >
          Import annotations
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["bookmarks", "highlights", "notes", "restore", "json"],
    sectionId: "storage",
  },
  {
    description: "Forces EPUB files to be checked again later.",
    groupLabel: "Archive maintenance",
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
