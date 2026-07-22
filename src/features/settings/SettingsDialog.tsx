import { X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { IconButton } from "../../components/IconButton";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import { getProgrammaticScrollBehavior } from "../../utils/motion";
import { ThemeManagerDialog } from "../themes/ThemeManagerDialog";
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
import { KeyboardSettingsSection } from "./sections/KeyboardSettingsSection";
import { StorageSettingsSection } from "./sections/StorageSettingsSection";
import { getSettingsItemsDataRequirements, getSettingsItemsForSection } from "./settingsItems";
import { findSettingsSearchResults } from "./settingsSearch";
import { settingsSections, type SettingsSection } from "./settingsSections";
import { useArchiveThemeCatalogEntries } from "../themes/useArchiveThemeCatalogEntries";
import { useCommittedArchiveAppearance } from "../themes/useCommittedArchiveAppearance";
import { useSettingsDialogController } from "./useSettingsDialogController";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import { ariaKeyShortcut, commandDefinitions } from "../quick-actions/commandBindings";

type SettingsDialogProps = {
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
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
    case "keyboard":
      return <KeyboardSettingsSection context={controller} />;
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

export function SettingsDialog({ onClose, returnFocusTo }: SettingsDialogProps) {
  const contentRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [themeManagerOpen, setThemeManagerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { getCommandBinding } = useQuickActions();
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
  const themeCatalog = useArchiveThemeCatalogEntries(
    dataRequirements.has("archiveAppearanceSettings"),
  );
  const committedArchiveAppearance = useCommittedArchiveAppearance();
  const modal = useModalDialogLifecycle({
    dialogRef,
    onClose,
    returnFocusTo,
    surfaceKind: "settings",
  });
  const controller = useSettingsDialogController({
    committedArchiveAppearance,
    loadArchiveImportSettings: dataRequirements.has("archiveImportSettings"),
    loadCoverCacheStatus: dataRequirements.has("coverCacheStatus"),
    loadEpubWritebackBackupStatus: dataRequirements.has("epubWritebackBackupStatus"),
    loadFolders: dataRequirements.has("folders"),
    onOpenThemeManager: () => setThemeManagerOpen(true),
    themeCatalogEntries: themeCatalog.entries,
    themeCatalogLoading: themeCatalog.loading,
  });
  const settingsCommands = useMemo(
    () => [
      {
        ...commandDefinitions.focusSearch,
        execute: () => searchInputRef.current?.focus({ preventScroll: true }),
        keywords: ["find setting", "search preferences"],
        scope: "settings" as const,
      },
    ],
    [],
  );
  useRegisterQuickActions("settings", settingsCommands);
  const focusSearchAriaKeyShortcuts = ariaKeyShortcut(
    getCommandBinding(commandDefinitions.focusSearch.id),
  );

  function showSection(section: SettingsSection) {
    setActiveSection(section);
    scrollSettingsContent(contentRef.current);
  }

  function clearSearch() {
    setQuery("");
    scrollSettingsContent(contentRef.current);
  }

  useEffect(() => {
    scrollSettingsContent(contentRef.current);
  }, [trimmedQuery]);

  return (
    <dialog
      aria-labelledby="settings-title"
      aria-modal="true"
      className="settings-dialog"
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
      ref={dialogRef}
    >
      <div className="settings-window modal-surface">
        <SettingsSidebar
          onQueryChange={setQuery}
          searchAriaKeyShortcuts={focusSearchAriaKeyShortcuts}
          onSectionChange={showSection}
          query={query}
          searchInputRef={searchInputRef}
          sections={settingsSections}
          selectedSection={selectedSection}
        />

        <IconButton autoFocus className="settings-close" label="Close settings" onClick={onClose}>
          <X aria-hidden="true" />
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
            status={
              controller.status ??
              (themeCatalog.error ? { message: themeCatalog.error, tone: "error" } : null)
            }
          />
        </main>

        <SettingsConfirmations
          confirmations={controller.confirmations}
          onClearCoverCache={controller.confirmClearCoverCache}
          onClearEpubWritebackBackups={controller.confirmClearEpubWritebackBackups}
          onClearScannerCache={controller.confirmClearScannerCache}
          onClose={controller.closeConfirmation}
          onReextractMetadata={controller.confirmReextractMetadata}
          onRepairMetadata={controller.confirmRepairMetadata}
          onRescanArchive={controller.confirmRescanArchive}
        />

        {themeManagerOpen && controller.selectedArchivePath ? (
          <ThemeManagerDialog
            archiveRootPath={controller.selectedArchivePath}
            onClose={() => setThemeManagerOpen(false)}
          />
        ) : null}
      </div>
    </dialog>
  );
}
