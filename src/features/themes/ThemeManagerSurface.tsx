import { FilePlus, FolderOpen, RefreshCw } from "lucide-react";
import { useContext, useMemo, useRef, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { ThemeManagerLayout } from "./ThemeManagerLayout";
import { ThemeManagerLayoutContext } from "./themeManagerLayoutContext";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
import { appearanceRuntime, themeCatalog } from "../../themes/appearanceRuntimeInstance";
import { ARCHEION_THEME_SCHEMA_URL } from "../../themes/themeTokenRegistry";
import { ThemeRepository } from "../../themes/ThemeRepository";
import { ThemePreviewSession } from "../../themes/ThemePreviewSession";
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
  previewSession?: ThemeManagerControllerOptions["previewSession"];
  repository: ThemeManagerRepository;
  runtime: ThemeManagerControllerOptions["runtime"];
}>;

type ThemeManagerSurfaceProps = Readonly<{
  services?: ThemeManagerServices;
}>;

export function ThemeManagerSurface(props: ThemeManagerSurfaceProps) {
  const layout = useContext(ThemeManagerLayoutContext);
  return layout ? (
    <ThemeManagerContent {...props} />
  ) : (
    <ThemeManagerLayout>
      <ThemeManagerContent {...props} />
    </ThemeManagerLayout>
  );
}

function ThemeManagerContent({ services }: ThemeManagerSurfaceProps) {
  const layout = useContext(ThemeManagerLayoutContext)!;
  const repository = useMemo(
    () => services?.repository ?? new ThemeRepository(),
    [services?.repository],
  );
  const previewSession = useMemo(
    () => services?.previewSession ?? new ThemePreviewSession(appearanceRuntime),
    [services?.previewSession],
  );
  const controller = useThemeManagerController({
    catalog: services?.catalog ?? themeCatalog,
    previewSession,
    repository,
    runtime: services?.runtime ?? appearanceRuntime,
  });
  const importInputRef = useRef<HTMLInputElement>(null);
  const busy = controller.busyAction !== null;

  async function readChosenFile(
    event: ChangeEvent<HTMLInputElement>,
    action: (file: File) => Promise<boolean>,
  ) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) await action(file);
  }

  return (
    <>
      {layout.toolbarHost &&
        createPortal(
          <div className="theme-manager__toolbar">
            <div className="theme-manager__toolbar-actions">
              <Button
                className="theme-manager__import"
                disabled={busy || controller.previewActive}
                icon={<FilePlus aria-hidden="true" />}
                onClick={() => importInputRef.current?.click()}
                size="standard"
              >
                Import
              </Button>
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
            </div>
            <nav aria-label="Theme resources" className="theme-manager__toolbar-links">
              <a href={THEME_GUIDE_URL} rel="noreferrer" target="_blank">
                Theme guide
              </a>
              <a href={ARCHEION_THEME_SCHEMA_URL} rel="noreferrer" target="_blank">
                Public schema
              </a>
            </nav>
          </div>,
          layout.toolbarHost,
        )}
      <input
        accept=".json,application/json"
        aria-label="Import theme file"
        className="sr-only"
        onChange={(event) => void readChosenFile(event, controller.importFile)}
        ref={importInputRef}
        tabIndex={-1}
        type="file"
      />

      {layout.noticeHost &&
        createPortal(
          <>
            {controller.error ? (
              <p className="theme-manager__status" data-tone="error" role="alert">
                {controller.error}
              </p>
            ) : controller.message ? (
              <p className="theme-manager__status" aria-live="polite">
                {controller.message}
              </p>
            ) : null}
          </>,
          layout.noticeHost,
        )}

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

      {layout.catalogHost &&
        createPortal(
          <ThemeCatalogList
            activeThemeKey={controller.activeAppThemeKey}
            busy={busy}
            entries={controller.entries}
            onSelect={controller.select}
            selectedKey={controller.selectedKey}
          />,
          layout.catalogHost,
        )}
      <ThemeDetails controller={controller} />

      {layout.previewHost &&
        createPortal(<ThemePreviewControls session={previewSession} />, layout.previewHost)}
    </>
  );
}
