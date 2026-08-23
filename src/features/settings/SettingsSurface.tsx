import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { IconButton } from "../../components/IconButton";
import { getProgrammaticScrollBehavior, isAppMotionEnabled } from "../../utils/motion";
import { ariaKeyShortcut, commandDefinitions } from "../commands/commandBindings";
import { useQuickActions, useRegisterQuickActions } from "../quick-actions/QuickActionsContext";
import { ThemeManagerDialog } from "../themes/ThemeManagerDialog";
import { useThemeCatalogEntries } from "../themes/useThemeCatalogEntries";
import { SettingsConfirmations } from "./SettingsConfirmations";
import { SettingsSearchResults } from "./SettingsSearchResults";
import { SettingsSidebar } from "./SettingsSidebar";
import { SettingsStatus } from "./SettingsStatus";
import { AppearanceSettingsSection } from "./sections/AppearanceSettingsSection";
import { ArchivesSettingsSection } from "./sections/ArchivesSettingsSection";
import { DictionarySettingsSection } from "./sections/DictionarySettingsSection";
import { GeneralSettingsSection } from "./sections/GeneralSettingsSection";
import { ImportSettingsSection } from "./sections/ImportSettingsSection";
import { KeyboardSettingsSection } from "./sections/KeyboardSettingsSection";
import { LibrarySettingsSection } from "./sections/LibrarySettingsSection";
import { ReaderSettingsSection } from "./sections/ReaderSettingsSection";
import { StorageSettingsSection } from "./sections/StorageSettingsSection";
import { getSettingsItemsDataRequirements, getSettingsItemsForSection } from "./settingsItems";
import { findSettingsSearchResults } from "./settingsSearch";
import { settingsSections, type SettingsSection } from "./settingsSections";
import { useSettingsDialogController } from "./useSettingsDialogController";
import type { SettingsArchiveBoundary } from "./useSettingsArchiveMaintenance";

type SettingsSurfaceProps = {
  archiveAccess: "required" | "unavailable";
  archiveBoundary?: SettingsArchiveBoundary;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
  initialSection?: SettingsSection;
  onClose?: () => void;
  standalone?: boolean;
};

function scrollSettingsContent(content: HTMLElement | null) {
  content?.scrollTo({ top: 0, behavior: getProgrammaticScrollBehavior() });
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

export function SettingsSurface({
  archiveAccess,
  archiveBoundary,
  closeButtonRef,
  initialSection = "general",
  onClose,
  standalone = false,
}: SettingsSurfaceProps) {
  const contentRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [animateSectionChange, setAnimateSectionChange] = useState(false);
  const [themeManagerOpen, setThemeManagerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { getCommandBinding } = useQuickActions();
  const trimmedQuery = query.trim();
  const searchActive = trimmedQuery.length > 0;
  const archiveAvailable = archiveAccess === "required" || Boolean(archiveBoundary?.maintenance);
  const selectedSection = useMemo(
    () => (sectionIsKnown(activeSection) ? activeSection : "general"),
    [activeSection],
  );
  const visibleSettingsItems = useMemo(() => {
    const items = searchActive
      ? findSettingsSearchResults(trimmedQuery).map((result) => result.item)
      : getSettingsItemsForSection(selectedSection);
    return archiveAvailable ? items : items.filter((item) => !item.requiresArchive);
  }, [archiveAvailable, searchActive, selectedSection, trimmedQuery]);
  const dataRequirements = useMemo(
    () => getSettingsItemsDataRequirements(visibleSettingsItems),
    [visibleSettingsItems],
  );
  const themeCatalog = useThemeCatalogEntries(dataRequirements.has("themeCatalog"), {
    reportRefreshFailure: !themeManagerOpen,
  });
  const controller = useSettingsDialogController({
    archiveAccess,
    archiveGeneration: archiveBoundary?.snapshot.generation,
    archiveIdentity: archiveBoundary?.snapshot.archive,
    archiveMaintenance: archiveBoundary?.maintenance,
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
    setAnimateSectionChange(section !== selectedSection && isAppMotionEnabled());
    setActiveSection(section);
    scrollSettingsContent(contentRef.current);
  }

  function clearSearch() {
    setAnimateSectionChange(false);
    setQuery("");
    scrollSettingsContent(contentRef.current);
  }

  useEffect(() => scrollSettingsContent(contentRef.current), [trimmedQuery]);

  return (
    <div
      className={`settings-window${standalone ? " settings-window--standalone" : " modal-surface"}`}
    >
      <SettingsSidebar
        onQueryChange={(nextQuery) => {
          setAnimateSectionChange(false);
          setQuery(nextQuery);
        }}
        searchAriaKeyShortcuts={focusSearchAriaKeyShortcuts}
        onSectionChange={showSection}
        query={query}
        searchInputRef={searchInputRef}
        sections={settingsSections}
        selectedSection={selectedSection}
      />

      {onClose ? (
        <IconButton
          className="settings-close"
          label="Close settings"
          onClick={onClose}
          ref={closeButtonRef}
        >
          <X aria-hidden="true" />
        </IconButton>
      ) : null}

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
              if (event.currentTarget === event.target) setAnimateSectionChange(false);
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

      {themeManagerOpen ? <ThemeManagerDialog onClose={() => setThemeManagerOpen(false)} /> : null}
    </div>
  );
}
