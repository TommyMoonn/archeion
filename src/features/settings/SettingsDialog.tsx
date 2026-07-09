import { X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { IconButton } from "../../components/IconButton";
import { getProgrammaticScrollBehavior } from "../../utils/motion";
import { SettingsConfirmations } from "./SettingsConfirmations";
import { SettingsSearchResults } from "./SettingsSearchResults";
import { SettingsSidebar } from "./SettingsSidebar";
import { SettingsStatus } from "./SettingsStatus";
import { AppearanceSettingsSection } from "./sections/AppearanceSettingsSection";
import { ArchivesSettingsSection } from "./sections/ArchivesSettingsSection";
import { GeneralSettingsSection } from "./sections/GeneralSettingsSection";
import { ImportSettingsSection } from "./sections/ImportSettingsSection";
import { LibrarySettingsSection } from "./sections/LibrarySettingsSection";
import { ReaderSettingsSection } from "./sections/ReaderSettingsSection";
import { StorageSettingsSection } from "./sections/StorageSettingsSection";
import { getSettingsItemsDataRequirements, getSettingsItemsForSection } from "./settingsItems";
import { findSettingsSearchResults } from "./settingsSearch";
import { settingsSections, type SettingsSection } from "./settingsSections";
import { useSettingsDialogController } from "./useSettingsDialogController";

type SettingsDialogProps = {
  onClose: () => void;
};

function scrollSettingsContent(content: HTMLElement | null) {
  content?.scrollTo({
    top: 0,
    behavior: getProgrammaticScrollBehavior(),
  });
}

function sectionIsKnown(sectionId: SettingsSection) {
  return settingsSections.some((section) => section.id === sectionId);
}

function renderSettingsSection(
  section: SettingsSection,
  controller: ReturnType<typeof useSettingsDialogController>,
) {
  switch (section) {
    case "archives":
      return <ArchivesSettingsSection context={controller} />;
    case "library":
      return <LibrarySettingsSection context={controller} />;
    case "reader":
      return <ReaderSettingsSection context={controller} />;
    case "appearance":
      return <AppearanceSettingsSection context={controller} />;
    case "storage":
      return <StorageSettingsSection context={controller} />;
    case "import":
      return <ImportSettingsSection context={controller} />;
    case "general":
    default:
      return <GeneralSettingsSection context={controller} />;
  }
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const searchActive = trimmedQuery.length > 0;

  const selectedSection = useMemo(
    () => (sectionIsKnown(activeSection) ? activeSection : "general"),
    [activeSection],
  );
  const visibleSettingsItems = useMemo(() => {
    if (searchActive) {
      return findSettingsSearchResults(trimmedQuery).map((result) => result.item);
    }

    return getSettingsItemsForSection(selectedSection);
  }, [searchActive, selectedSection, trimmedQuery]);
  const dataRequirements = useMemo(
    () => getSettingsItemsDataRequirements(visibleSettingsItems),
    [visibleSettingsItems],
  );
  const controller = useSettingsDialogController({
    loadArchiveImportSettings: dataRequirements.has("archiveImportSettings"),
    loadCoverCacheStatus: dataRequirements.has("coverCacheStatus"),
    loadEpubWritebackBackupStatus: dataRequirements.has("epubWritebackBackupStatus"),
    loadFolders: dataRequirements.has("folders"),
  });

  function showSection(section: SettingsSection) {
    setActiveSection(section);
    scrollSettingsContent(contentRef.current);
  }

  function clearSearch() {
    setQuery("");
    scrollSettingsContent(contentRef.current);
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

  useEffect(() => {
    scrollSettingsContent(contentRef.current);
  }, [trimmedQuery]);

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
          sections={settingsSections}
          selectedSection={selectedSection}
        />

        <IconButton autoFocus className="settings-close" label="Close settings" onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </IconButton>

        <main className="settings-content" ref={contentRef}>
          {searchActive ? (
            <SettingsSearchResults
              key={trimmedQuery}
              controller={controller}
              onClearSearch={clearSearch}
              query={trimmedQuery}
            />
          ) : (
            renderSettingsSection(selectedSection, controller)
          )}

          <SettingsStatus
            persistenceStatus={controller.persistenceStatus}
            status={controller.status}
          />
        </main>

        <SettingsConfirmations
          confirmations={controller.confirmations}
          onClearCoverCache={controller.confirmClearCoverCache}
          onClearEpubWritebackBackups={controller.confirmClearEpubWritebackBackups}
          onClearScannerCache={controller.confirmClearScannerCache}
          onClose={controller.closeConfirmation}
          onReextractMetadata={controller.confirmReextractMetadata}
          onRescanArchive={controller.confirmRescanArchive}
        />
      </div>
    </dialog>
  );
}
