import { X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { IconButton } from "../../components/IconButton";
import { SettingsConfirmations } from "./SettingsConfirmations";
import { SettingsSidebar } from "./SettingsSidebar";
import { SettingsStatus } from "./SettingsStatus";
import { AppearanceSettingsSection } from "./sections/AppearanceSettingsSection";
import { ArchivesSettingsSection } from "./sections/ArchivesSettingsSection";
import { GeneralSettingsSection } from "./sections/GeneralSettingsSection";
import { ImportSettingsSection } from "./sections/ImportSettingsSection";
import { LibrarySettingsSection } from "./sections/LibrarySettingsSection";
import { ReaderSettingsSection } from "./sections/ReaderSettingsSection";
import { StorageSettingsSection } from "./sections/StorageSettingsSection";
import {
  sectionMatches,
  settingsSections,
  type SettingsSection,
} from "./settingsSections";
import { useSettingsDialogController } from "./useSettingsDialogController";

type SettingsDialogProps = {
  onClose: () => void;
};

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const controller = useSettingsDialogController();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");
  const [query, setQuery] = useState("");

  const visibleSections = useMemo(
    () =>
      settingsSections.filter((section) => sectionMatches(section.id, query)),
    [query],
  );
  const selectedSection = visibleSections.some(
    (section) => section.id === activeSection,
  )
    ? activeSection
    : (visibleSections[0]?.id ?? activeSection);
  const sectionHidden = (section: SettingsSection) => selectedSection !== section;

  function showSection(section: SettingsSection) {
    setActiveSection(section);
    contentRef.current?.scrollTo({ top: 0 });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      aria-labelledby="settings-title"
      aria-modal="true"
      className="settings-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <div className="settings-window">
        <SettingsSidebar
          onQueryChange={setQuery}
          onSectionChange={showSection}
          query={query}
          sections={visibleSections}
          selectedSection={selectedSection}
        />

        <IconButton
          autoFocus
          className="settings-close"
          label="Close settings"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </IconButton>

        <main className="settings-content" ref={contentRef}>
          <GeneralSettingsSection
            confirmDestructiveFileActions={
              controller.preferences.confirmDestructiveFileActions
            }
            hidden={sectionHidden("general")}
            onConfirmDestructiveFileActionsChange={
              (confirmDestructiveFileActions) =>
                void controller.updateAppPreferences({
                  confirmDestructiveFileActions,
                })
            }
            onReset={() => void controller.resetGeneral()}
            onRestoreLastReaderChange={(restoreLastReader) =>
              void controller.updateAppPreferences({ restoreLastReader })
            }
            onStartupBehaviorChange={(startupBehavior) =>
              void controller.updateAppPreferences({ startupBehavior })
            }
            restoreLastReader={controller.preferences.restoreLastReader}
            startupBehavior={controller.preferences.startupBehavior}
          />

          <ArchivesSettingsSection
            archivePath={controller.selectedArchivePath}
            hidden={sectionHidden("archives")}
            onOpenArchiveManager={() => void controller.openArchiveManager()}
            onRevealArchiveFolder={() => void controller.revealArchiveFolder()}
          />

          <LibrarySettingsSection
            bookCardSize={controller.preferences.bookCardSize}
            hidden={sectionHidden("library")}
            library={controller.library}
            onBookCardSizeChange={(bookCardSize) =>
              void controller.updateAppPreferences({ bookCardSize })
            }
            onReset={() => void controller.resetLibrary()}
            onShowContinueReadingChange={(showContinueReading) =>
              void controller.updateAppPreferences({ showContinueReading })
            }
            onSortByChange={(sortBy) => controller.updateLibrary({ sortBy })}
            onViewModeChange={(viewMode) => controller.updateLibrary({ viewMode })}
            showContinueReading={controller.preferences.showContinueReading}
          />

          <ReaderSettingsSection
            hidden={sectionHidden("reader")}
            onChange={controller.updateReader}
            onReset={() => void controller.resetReader()}
            reader={controller.reader}
          />

          <AppearanceSettingsSection
            appThemePreset={controller.preferences.appThemePreset}
            density={controller.preferences.density}
            hidden={sectionHidden("appearance")}
            onAppThemePresetChange={(appThemePreset) =>
              void controller.updateAppPreferences({ appThemePreset })
            }
            onDensityChange={(density) =>
              void controller.updateAppPreferences({ density })
            }
            onRememberWindowStateChange={(rememberWindowState) =>
              void controller.updateAppPreferences({ rememberWindowState })
            }
            onResetAppearance={() => void controller.resetAppearance()}
            onResetWindow={() => void controller.resetWindow()}
            onWindowFrameStyleChange={(windowFrameStyle) =>
              void controller.updateAppPreferences({ windowFrameStyle })
            }
            rememberWindowState={controller.preferences.rememberWindowState}
            windowFrameStyle={controller.preferences.windowFrameStyle}
          />

          <StorageSettingsSection
            cache={controller.cache}
            files={controller.files}
            hidden={sectionHidden("storage")}
            onClearCoverCache={() =>
              controller.openConfirmation("clearCoverCache")
            }
            onClearScannerCache={() =>
              controller.openConfirmation("clearScannerCache")
            }
            onLiveWatcherEnabledChange={(liveWatcherEnabled) =>
              controller.updateFiles({ liveWatcherEnabled })
            }
            onReextractMetadata={() =>
              controller.openConfirmation("reextractMetadata")
            }
            onRescan={() => controller.openConfirmation("rescanArchive")}
            onReset={() => void controller.resetStorage()}
            onRevealMetadataFolder={() => void controller.revealMetadata()}
            onScanOnStartupChange={(scanOnStartup) =>
              controller.updateFiles({ scanOnStartup })
            }
          />

          <ImportSettingsSection
            destinationOptions={controller.destinationOptions}
            hidden={sectionHidden("import")}
            importSettings={controller.importSettings}
            onConflictActionChange={(defaultConflictAction) =>
              controller.updateImportDefaults({ defaultConflictAction })
            }
            onDestinationChange={controller.updateImportDestination}
            onImportModeChange={(defaultMode) =>
              controller.updateImportDefaults({ defaultMode })
            }
            onReset={() => void controller.resetImport()}
            safeDestinationValue={controller.safeImportDestinationValue}
          />

          <SettingsStatus
            persistenceStatus={controller.persistenceStatus}
            status={controller.status}
          />
        </main>

        <SettingsConfirmations
          confirmations={controller.confirmations}
          onClearCoverCache={controller.confirmClearCoverCache}
          onClearScannerCache={controller.confirmClearScannerCache}
          onClose={controller.closeConfirmation}
          onReextractMetadata={controller.confirmReextractMetadata}
          onRescanArchive={controller.confirmRescanArchive}
        />
      </div>
    </dialog>
  );
}
