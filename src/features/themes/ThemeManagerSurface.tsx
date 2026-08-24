import { FilePlus, FolderOpen, RefreshCw, X } from "lucide-react";
import { useMemo, useRef, type ChangeEvent } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
import { appearanceRuntime, themeCatalog } from "../../themes/appearanceRuntimeInstance";
import { ARCHEION_THEME_SCHEMA_URL } from "../../themes/themeTokenRegistry";
import { ThemeRepository } from "../../themes/ThemeRepository";
import { themePreviewSession } from "../../themes/themePreviewSessionInstance";
import { ThemeCatalogList } from "./ThemeCatalogList";
import { ThemeDetails } from "./ThemeDetails";
import { ThemePreviewControls } from "./ThemePreviewControls";
import {
  useThemeManagerController,
  type ThemeManagerControllerOptions,
  type ThemeManagerRepository,
} from "./useThemeManagerController";

const THEME_GUIDE_URL = "https://tommymoonn.github.io/archeion/custom-themes.html";

export type ThemeManagerServices = Readonly<{
  catalog: ThemeManagerControllerOptions["catalog"];
  previewSession: ThemeManagerControllerOptions["previewSession"];
  repository: ThemeManagerRepository;
  runtime: ThemeManagerControllerOptions["runtime"];
}>;

type ThemeManagerSurfaceProps = Readonly<{
  onClose: () => void;
  services?: ThemeManagerServices;
  standalone?: boolean;
}>;

export function ThemeManagerSurface({
  onClose,
  services,
  standalone = false,
}: ThemeManagerSurfaceProps) {
  const repository = useMemo(
    () => services?.repository ?? new ThemeRepository(),
    [services?.repository],
  );
  const controller = useThemeManagerController({
    catalog: services?.catalog ?? themeCatalog,
    previewSession: services?.previewSession ?? themePreviewSession,
    repository,
    runtime: services?.runtime ?? appearanceRuntime,
  });
  const importInputRef = useRef<HTMLInputElement>(null);
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
    <section
      aria-labelledby={standalone ? "theme-manager-title" : undefined}
      className={`theme-manager-surface${standalone ? " theme-manager-surface--standalone" : ""}`}
    >
      {standalone ? <h1 id="theme-manager-title">Theme Manager</h1> : null}
      <div className="theme-manager__toolbar">
        <span className="theme-manager__toolbar-links">
          <a href={THEME_GUIDE_URL} rel="noreferrer" target="_blank">
            Theme guide
          </a>
          <a href={ARCHEION_THEME_SCHEMA_URL} rel="noreferrer" target="_blank">
            Public schema
          </a>
        </span>
        <div className="theme-manager__toolbar-actions">
          <IconButton
            disabled={busy || controller.previewActive}
            label="Reload themes"
            onClick={() => void controller.reload()}
            size="standard"
          >
            <RefreshCw aria-hidden="true" />
          </IconButton>
          <IconButton
            disabled={busy || controller.previewActive}
            label="Open themes folder"
            onClick={() => void controller.openThemesFolder()}
            size="standard"
          >
            <FolderOpen aria-hidden="true" />
          </IconButton>
          <Button
            className="theme-manager__import"
            disabled={busy || controller.previewActive}
            icon={<FilePlus aria-hidden="true" />}
            onClick={() => importInputRef.current?.click()}
            size="standard"
            variant="secondary"
          >
            Import
          </Button>
        </div>
      </div>
      <IconButton
        className="theme-manager__close"
        label="Close Theme Manager"
        onClick={close}
        size="compact"
      >
        <X aria-hidden="true" strokeWidth={2.25} />
      </IconButton>
      <input
        accept=".json,application/json"
        aria-label="Import theme file"
        className="sr-only"
        onChange={(event) => void readChosenFile(event, controller.importFile)}
        ref={importInputRef}
        tabIndex={-1}
        type="file"
      />

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
          description="A theme with this ID already exists. Updating theme.json preserves the package's other files."
          footer={
            <>
              <Button onClick={controller.cancelReplacement} size="standard" variant="secondary">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  void controller.confirmReplacement();
                }}
                size="standard"
                variant="primary"
              >
                Update theme
              </Button>
            </>
          }
          onClose={controller.cancelReplacement}
          title="Update existing theme?"
        >
          {controller.error ? (
            <p data-tone="error" role="alert">
              {controller.error}
            </p>
          ) : null}
        </Dialog>
      ) : null}

      <div className="theme-manager__workspace" aria-busy={busy || undefined}>
        <ThemeCatalogList
          activeThemeKey={controller.activeAppThemeKey}
          busy={busy}
          entries={controller.entries}
          onSelect={controller.select}
          selectedKey={controller.selectedKey}
        />
        <ThemeDetails controller={controller} />
      </div>

      <ThemePreviewControls session={services?.previewSession ?? themePreviewSession} />
    </section>
  );
}
