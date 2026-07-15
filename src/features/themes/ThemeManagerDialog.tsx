import { ArrowsClockwise, FilePlus, FolderOpen, Plus } from "@phosphor-icons/react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { appearanceRuntime, archiveThemeCatalog } from "../../themes/appearanceRuntimeInstance";
import { ArchiveThemeRepository } from "../../themes/ArchiveThemeRepository";
import { ARCHEION_THEME_SCHEMA_URL } from "../../themes/themeTokenRegistry";
import { themePreviewSession } from "../../themes/themePreviewSessionInstance";
import { CreateStarterThemePanel } from "./CreateStarterThemePanel";
import { ThemeCatalogList } from "./ThemeCatalogList";
import { ThemeDetails } from "./ThemeDetails";
import { ThemePreviewControls } from "./ThemePreviewControls";
import {
  useThemeManagerController,
  type ThemeManagerControllerOptions,
  type ThemeManagerRepository,
} from "./useThemeManagerController";

const THEME_GUIDE_URL = "https://tommymoonn.github.io/archeion/custom-themes.html";

type ThemeManagerDialogProps = Readonly<{
  archiveRootPath: string;
  onAppearanceChanged?: ThemeManagerControllerOptions["onAppearanceChanged"];
  onClose: () => void;
  services?: Readonly<{
    catalog: ThemeManagerControllerOptions["catalog"];
    previewSession: ThemeManagerControllerOptions["previewSession"];
    repository: ThemeManagerRepository;
    runtime: ThemeManagerControllerOptions["runtime"];
  }>;
}>;

export function ThemeManagerDialog({
  archiveRootPath,
  onAppearanceChanged,
  onClose,
  services,
}: ThemeManagerDialogProps) {
  const repository = useMemo(
    () => services?.repository ?? new ArchiveThemeRepository(archiveRootPath),
    [archiveRootPath, services?.repository],
  );
  const controller = useThemeManagerController({
    archiveRootPath,
    catalog: services?.catalog ?? archiveThemeCatalog,
    onAppearanceChanged,
    onArchiveScopeInvalidated: onClose,
    previewSession: services?.previewSession ?? themePreviewSession,
    repository,
    runtime: services?.runtime ?? appearanceRuntime,
  });
  const importInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [starterOpen, setStarterOpen] = useState(false);
  const busy = controller.busyAction !== null;

  function close() {
    controller.disposePreview();
    onClose();
  }

  async function readChosenFile(
    event: ChangeEvent<HTMLInputElement>,
    action: (file: File) => Promise<boolean>,
  ) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) await action(file);
  }

  return (
    <Dialog
      className="theme-manager-dialog"
      closeOnBackdropClick={false}
      description={`Archive-local themes in ${archiveRootPath}`}
      footer={
        <Button onClick={close} variant="secondary">
          Close
        </Button>
      }
      onClose={close}
      title="Theme Manager"
    >
      <input
        accept=".json,application/json"
        className="sr-only"
        onChange={(event) => void readChosenFile(event, controller.importFile)}
        ref={importInputRef}
        tabIndex={-1}
        type="file"
      />
      <input
        accept=".json,application/json"
        className="sr-only"
        onChange={(event) => void readChosenFile(event, controller.prepareReplacement)}
        ref={replaceInputRef}
        tabIndex={-1}
        type="file"
      />

      <div className="theme-manager__toolbar">
        <Button
          disabled={busy || controller.previewActive}
          icon={<FilePlus aria-hidden="true" />}
          onClick={() => importInputRef.current?.click()}
          size="standard"
          variant="secondary"
        >
          Import JSON
        </Button>
        <Button
          disabled={busy || controller.previewActive}
          icon={<Plus aria-hidden="true" />}
          onClick={() => setStarterOpen(true)}
          size="standard"
          variant="secondary"
        >
          Create starter
        </Button>
        <Button
          disabled={busy || controller.previewActive}
          icon={<ArrowsClockwise aria-hidden="true" />}
          onClick={() => void controller.reload()}
          size="standard"
          variant="ghost"
        >
          Reload
        </Button>
        <Button
          disabled={busy || controller.previewActive}
          icon={<FolderOpen aria-hidden="true" />}
          onClick={() => void controller.reveal("root")}
          size="standard"
          variant="ghost"
        >
          Reveal themes folder
        </Button>
        <span className="theme-manager__toolbar-links">
          <a href={THEME_GUIDE_URL} rel="noreferrer" target="_blank">
            Theme guide
          </a>
          <a href={ARCHEION_THEME_SCHEMA_URL} rel="noreferrer" target="_blank">
            Public schema
          </a>
        </span>
      </div>

      {controller.error ? (
        <p className="theme-manager__status" data-tone="error" role="alert">
          {controller.error}
        </p>
      ) : controller.message ? (
        <p className="theme-manager__status" aria-live="polite">
          {controller.message}
        </p>
      ) : null}

      {controller.pendingReplacement ? (
        <Dialog
          closeOnBackdropClick={false}
          description={`Replace the existing “${controller.pendingReplacement.manifest.id}” theme.json? Other package files are preserved.`}
          footer={
            <>
              <Button onClick={controller.cancelReplacement} size="standard" variant="secondary">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const source = controller.pendingReplacement?.source;
                  void controller.confirmReplacement().then((replaced) => {
                    if (replaced && source === "starter") setStarterOpen(false);
                  });
                }}
                size="standard"
                variant="danger"
              >
                Replace theme
              </Button>
            </>
          }
          onClose={controller.cancelReplacement}
          title="Replace theme?"
        >
          {controller.error ? <p role="alert">{controller.error}</p> : null}
        </Dialog>
      ) : null}

      {starterOpen ? (
        <CreateStarterThemePanel controller={controller} onClose={() => setStarterOpen(false)} />
      ) : (
        <div className="theme-manager__workspace" aria-busy={busy || undefined}>
          <ThemeCatalogList
            busy={busy}
            entries={controller.snapshot.entries}
            onSelect={controller.select}
            selectedKey={controller.selectedKey}
          />
          <ThemeDetails
            controller={controller}
            onChooseReplacement={() => replaceInputRef.current?.click()}
          />
        </div>
      )}

      <ThemePreviewControls session={services?.previewSession ?? themePreviewSession} />
    </Dialog>
  );
}
