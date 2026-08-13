import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { IconButton } from "../../components/IconButton";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import { getProgrammaticScrollBehavior, isAppMotionEnabled } from "../../utils/motion";
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
import { DictionarySettingsSection } from "./sections/DictionarySettingsSection";
import { KeyboardSettingsSection } from "./sections/KeyboardSettingsSection";
import { StorageSettingsSection } from "./sections/StorageSettingsSection";
import { getSettingsItemsDataRequirements, getSettingsItemsForSection } from "./settingsItems";
import { findSettingsSearchResults } from "./settingsSearch";
import { settingsSections, type SettingsSection } from "./settingsSections";
import { useArchiveThemeCatalogEntries } from "../themes/useArchiveThemeCatalogEntries";
import { useCommittedArchiveAppearance } from "../themes/useCommittedArchiveAppearance";
import { useSettingsDialogController } from "./useSettingsDialogController";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import { ariaKeyShortcut, commandDefinitions } from "../commands/commandBindings";
import type { FocusReturnRecord } from "../../utils/focusRestoration";

type SettingsDialogProps = {
  focusReturn?: FocusReturnRecord;
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
    case "dictionaries":
      return <DictionarySettingsSection />;
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

export function SettingsDialog({ focusReturn, onClose }: SettingsDialogProps) {
  const contentRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [animateSectionChange, setAnimateSectionChange] = useState(false);
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
    { reportRefreshFailure: !themeManagerOpen },
  );
  const committedArchiveAppearance = useCommittedArchiveAppearance();
  const modal = useModalDialogLifecycle({
    dialogRef,
    focusReturn,
    initialFocusRef: closeButtonRef,
    onClose,
    surfaceKind: "settings",
  });
  const controller = useSettingsDialogController({
    committedArchiveAppearance,
    loadArchiveImportSettings: dataRequirements.has("archiveImportSettings"),
    loadCoverCacheStatus: dataRequirements.has("coverCacheStatus"),
    loadEpubWritebackBackupStatus: dataRequirements.has("epubWritebackBackupStatus"),
    loadFolders: dataRequirements.has("folders"),
    onOpenThemeManager: () => {
      themeCatalog.retireRefreshFailure();
      setThemeManagerOpen(true);
    },
    refreshThemeCatalog: themeCatalog.refresh,
    themeCatalogEntries: themeCatalog.entries,
    themeCatalogLoading: themeCatalog.loading,
  });
  const settingsCommands = useMemo(
    () => [
      {
        ...commandDefinitions.focusSearch,
        execute: () => searchInputRef.current?.focus({ preventScroll: true }),
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
    const sectionChanged = section !== selectedSection;

    setAnimateSectionChange(sectionChanged && isAppMotionEnabled());
    setActiveSection(section);
    scrollSettingsContent(contentRef.current);
  }

  function updateQuery(nextQuery: string) {
    setAnimateSectionChange(false);
    setQuery(nextQuery);
  }

  function clearSearch() {
    setAnimateSectionChange(false);
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
          onQueryChange={updateQuery}
          searchAriaKeyShortcuts={focusSearchAriaKeyShortcuts}
          onSectionChange={showSection}
          query={query}
          searchInputRef={searchInputRef}
          sections={settingsSections}
          selectedSection={selectedSection}
        />

        <IconButton
          className="settings-close"
          label="Close settings"
          onClick={onClose}
          ref={closeButtonRef}
        >
          <X aria-hidden="true" />
        </IconButton>

        <section aria-label="Settings content" className="settings-content" ref={contentRef}>
          {searchActive ? (
            <SettingsSearchResults
              key={trimmedQuery}
              controller={controller}
              onClearSearch={clearSearch}
              query={trimmedQuery}
            />
          ) : (
            <div
              className="settings-section-transition"
              data-transition={animateSectionChange ? "section-change" : undefined}
              key={selectedSection}
              onAnimationEnd={(event) => {
                if (event.currentTarget === event.target) {
                  setAnimateSectionChange(false);
                }
              }}
            >
              {renderSettingsSection(selectedSection, controller)}
            </div>
          )}

          <SettingsStatus
            onDismiss={controller.dismissStatus}
            persistenceStatus={controller.persistenceStatus}
            status={
              controller.status ??
              (themeCatalog.error ? { message: themeCatalog.error, tone: "error" } : null)
            }
          />
        </section>

        <SettingsConfirmations
          archiveScanActive={controller.archiveScanActive}
          busyConfirmations={controller.busyConfirmations}
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
