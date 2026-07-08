import { X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { IconButton } from "../../components/IconButton";
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
import {
  getSettingsItemsDataRequirements,
  getSettingsItemsForSection,
} from "./settingsItems";
import { findSettingsSearchResults } from "./settingsSearch";
import { settingsSections, type SettingsSection } from "./settingsSections";
import { useSettingsDialogController } from "./useSettingsDialogController";

type SettingsDialogProps = {
  onClose: () => void;
};

function sectionIsKnown(sectionId: SettingsSection) {
  return settingsSections.some((section) => section.id === sectionId);
}

function renderSettingsSection(
  section: SettingsSection,
  controller: ReturnType<typeof useSettingsDialogController>,
) {
  switch (section) {
    case "archives":
      return <ArchivesSettingsSection context={controller} hidden={false} />;
    case "library":
      return <LibrarySettingsSection context={controller} hidden={false} />;
    case "reader":
      return <ReaderSettingsSection context={controller} hidden={false} />;
    case "appearance":
      return <AppearanceSettingsSection context={controller} hidden={false} />;
    case "storage":
      return <StorageSettingsSection context={controller} hidden={false} />;
    case "import":
      return <ImportSettingsSection context={controller} hidden={false} />;
    case "general":
    default:
      return <GeneralSettingsSection context={controller} hidden={false} />;
  }
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");
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
    loadFolders: dataRequirements.has("folders"),
  });

  function showSection(section: SettingsSection) {
    setActiveSection(section);
    contentRef.current?.scrollTo({ top: 0 });
  }

  function clearSearch() {
    setQuery("");
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

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
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

        <IconButton
          autoFocus
          className="settings-close"
          label="Close settings"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </IconButton>

        <main className="settings-content" ref={contentRef}>
          {searchActive ? (
            <SettingsSearchResults
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
          onClearScannerCache={controller.confirmClearScannerCache}
          onClose={controller.closeConfirmation}
          onReextractMetadata={controller.confirmReextractMetadata}
          onRescanArchive={controller.confirmRescanArchive}
        />
      </div>
    </dialog>
  );
}
