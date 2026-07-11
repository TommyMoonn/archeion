import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { router } from "../../app/router";
import { DialogLoadingFallback } from "../../components/DialogLoadingFallback";
import { archiveStore } from "../../stores/archiveStore";
import {
  isQuickActionsShortcut,
  isTextEntryTarget,
  QuickActionsRegistry,
  type QuickActionCommand,
} from "./quickActions";
import { QuickActionsContext, type QuickActionsContextValue } from "./QuickActionsContext";

const loadQuickActionsPalette = () =>
  import("./QuickActionsPalette").then((module) => ({ default: module.QuickActionsPalette }));
const loadSettingsDialog = () =>
  import("../settings/SettingsDialog").then((module) => ({ default: module.SettingsDialog }));

const QuickActionsPalette = lazy(loadQuickActionsPalette);
const SettingsDialog = lazy(loadSettingsDialog);

const quickActionsRegistry = new QuickActionsRegistry();

export function QuickActionsProvider({ children }: { children: ReactNode }) {
  const registry = quickActionsRegistry;
  const openerRef = useRef<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const archive = useSyncExternalStore(
    archiveStore.subscribe,
    archiveStore.getSnapshot,
    archiveStore.getSnapshot,
  );

  const openPalette = useCallback(() => {
    const activeElement = document.activeElement;
    openerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback((restoreFocus = true) => {
    setPaletteOpen(false);
    if (!restoreFocus) {
      openerRef.current = null;
      return;
    }

    const opener = openerRef.current;
    openerRef.current = null;
    window.requestAnimationFrame(() => {
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
    });
  }, []);

  const preloadSettings = useCallback(() => {
    void loadSettingsDialog();
  }, []);

  const openSettings = useCallback(() => {
    preloadSettings();
    setSettingsOpen(true);
  }, [preloadSettings]);

  const registerCommands = useCallback(
    (sourceId: string, commands: readonly QuickActionCommand[]) =>
      registry.register(sourceId, commands),
    [registry],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (paletteOpen && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePalette(true);
        return;
      }

      if (!isQuickActionsShortcut(event) || isTextEntryTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openPalette();
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [closePalette, openPalette, paletteOpen]);

  const appCommands = useMemo<QuickActionCommand[]>(() => {
    const activeArchive = archive.status === "ready" ? archive.archive : null;
    const commands: QuickActionCommand[] = [
      {
        disabledReason: activeArchive ? undefined : "No archive is open.",
        execute: () => {
          if (activeArchive) {
            void archiveStore.revealArchive(activeArchive.id);
          }
        },
        group: "Archive",
        id: "archive.open-current-folder",
        keywords: ["open current archive", "reveal folder", "file explorer"],
        label: "Open current archive folder",
        order: 10,
      },
      {
        execute: () => {
          void archiveStore.openArchiveManagerWindow();
        },
        group: "Archive",
        id: "archive.open-manager",
        keywords: ["manage archives", "archive manager"],
        label: "Open Archive Manager",
        order: 30,
      },
      {
        execute: openSettings,
        group: "System",
        id: "system.open-settings",
        keywords: ["preferences", "configuration"],
        label: "Open Settings",
        order: 90,
      },
    ];

    const switchTargets = archive.archives.filter(
      (candidate) => candidate.id !== activeArchive?.id,
    );
    if (switchTargets.length === 0) {
      commands.push({
        disabledReason: "No other known archives are available.",
        execute: () => undefined,
        group: "Archive",
        id: "archive.switch-unavailable",
        keywords: ["switch archive", "change archive"],
        label: "Switch archive",
        order: 20,
      });
    } else {
      commands.push(
        ...switchTargets.map<QuickActionCommand>((candidate, index) => ({
          execute: async () => {
            const switched = await archiveStore.switchArchive(candidate.id);
            if (switched) {
              await router.navigate("/", { replace: true });
            }
          },
          group: "Archive",
          id: `archive.switch.${candidate.id}`,
          keywords: ["switch archive", "change archive", candidate.rootPath],
          label: `Switch to ${candidate.displayName}`,
          order: 20 + index,
        })),
      );
    }

    return commands;
  }, [archive, openSettings]);

  useEffect(() => registry.register("app", appCommands), [appCommands, registry]);

  const contextValue = useMemo<QuickActionsContextValue>(
    () => ({ openPalette, openSettings, preloadSettings, registerCommands }),
    [openPalette, openSettings, preloadSettings, registerCommands],
  );

  return (
    <QuickActionsContext.Provider value={contextValue}>
      {children}
      {paletteOpen ? (
        <Suspense fallback={<QuickActionsLoadingFallback />}>
          <QuickActionsPalette
            onClose={() => closePalette(true)}
            onExecute={(command) => {
              registry.recordRecent(command.id);
              closePalette(false);
              window.requestAnimationFrame(() => {
                void Promise.resolve(command.execute()).catch((error) => {
                  console.error(`Quick Action failed: ${command.id}`, error);
                });
              });
            }}
            registry={registry}
          />
        </Suspense>
      ) : null}
      {settingsOpen ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening settings" />}>
          <SettingsDialog onClose={() => setSettingsOpen(false)} />
        </Suspense>
      ) : null}
    </QuickActionsContext.Provider>
  );
}

function QuickActionsLoadingFallback() {
  return (
    <div className="quick-actions-loading" role="status">
      <span>Opening Quick Actions</span>
    </div>
  );
}
