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
  commandDefinitions,
  defaultKeyboardPreferences,
  effectiveKeyboardBinding,
  getConfigurableCommandDefinition,
} from "./commandBindings";
import {
  createKeyboardInteractionContext,
  resolveKeyboardCommand,
  type KeyboardInteractionContext,
} from "./commandResolver";
import { QuickActionsRegistry, type QuickActionCommand } from "./quickActions";
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
  const keyboard = defaultKeyboardPreferences;
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
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
  }, []);

  const preloadSettings = useCallback(() => {
    void loadSettingsDialog();
  }, []);

  const openSettings = useCallback(() => {
    preloadSettings();
    setSettingsOpen(true);
  }, [preloadSettings]);

  const executeCommand = useCallback(
    (command: QuickActionCommand) => {
      registry.recordRecent(command.id);
      void Promise.resolve(command.execute()).catch((error) => {
        console.error(`Command failed: ${command.id}`, error);
      });
    },
    [registry],
  );

  const handleKeyboardEvent = useCallback(
    (event: KeyboardEvent, context?: KeyboardInteractionContext): boolean => {
      const resolved = resolveKeyboardCommand(
        event,
        registry.getSnapshot().commands,
        keyboard,
        context ?? createKeyboardInteractionContext(event, document),
      );
      if (!resolved) return false;

      event.preventDefault();
      event.stopPropagation();
      if (resolved.availability.available) executeCommand(resolved.command);
      return true;
    },
    [executeCommand, keyboard, registry],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyboardEvent, true);
    return () => document.removeEventListener("keydown", handleKeyboardEvent, true);
  }, [handleKeyboardEvent]);

  const registerCommands = useCallback(
    (sourceId: string, commands: readonly QuickActionCommand[]) =>
      registry.register(sourceId, commands),
    [registry],
  );

  const appCommands = useMemo<QuickActionCommand[]>(() => {
    const activeArchive = archive.status === "ready" ? archive.archive : null;
    const switchTargets = archive.archives.filter(
      (candidate) => candidate.id !== activeArchive?.id,
    );
    const switchCommands: QuickActionCommand[] =
      switchTargets.length === 0
        ? [
            {
              availability: {
                available: false,
                reason: "No other known archives are available.",
              },
              configuration: "unbound",
              execute: () => undefined,
              group: "Archive",
              id: "archive.switch-unavailable",
              keywords: ["switch archive", "change archive"],
              label: "Switch archive",
              order: 20,
              scope: "global",
            },
          ]
        : switchTargets.map((candidate, index) => ({
            configuration: "unbound",
            execute: async () => {
              const switched = await archiveStore.switchArchive(candidate.id);
              if (switched) await router.navigate("/", { replace: true });
            },
            group: "Archive",
            id: `archive.switch.${candidate.id}`,
            keywords: ["switch archive", "change archive", candidate.rootPath],
            label: `Switch to ${candidate.displayName}`,
            order: 20 + index,
            scope: "global",
          }));

    return [
      {
        ...commandDefinitions.quickActions,
        execute: openPalette,
        scope: "global",
        showInPalette: false,
      },
      {
        ...commandDefinitions.settings,
        availability: settingsOpen
          ? { available: false, reason: "Settings are already open." }
          : { available: true },
        execute: openSettings,
        keywords: ["preferences", "configuration"],
        order: 90,
        scope: "global",
      },
      {
        availability: activeArchive
          ? { available: true }
          : { available: false, reason: "No archive is open." },
        configuration: "unbound",
        execute: () => {
          if (activeArchive) void archiveStore.revealArchive(activeArchive.id);
        },
        group: "Archive",
        id: "archive.open-current-folder",
        keywords: ["open current archive", "reveal folder", "file explorer"],
        label: "Open current archive folder",
        order: 10,
        scope: "global",
      },
      ...switchCommands,
      {
        configuration: "unbound",
        execute: () => void archiveStore.openArchiveManagerWindow(),
        group: "Archive",
        id: "archive.open-manager",
        keywords: ["manage archives", "archive manager"],
        label: "Open Archive Manager",
        order: 30,
        scope: "global",
      },
    ];
  }, [archive, openPalette, openSettings, settingsOpen]);

  useEffect(() => registry.register("app", appCommands), [appCommands, registry]);

  const getCommandBinding = useCallback(
    (commandId: string) => {
      const definition = getConfigurableCommandDefinition(commandId);
      return definition ? effectiveKeyboardBinding(definition, keyboard) : undefined;
    },
    [keyboard],
  );

  const contextValue = useMemo<QuickActionsContextValue>(
    () => ({
      getCommandBinding,
      handleKeyboardEvent,
      openPalette,
      openSettings,
      preloadSettings,
      registerCommands,
    }),
    [
      getCommandBinding,
      handleKeyboardEvent,
      openPalette,
      openSettings,
      preloadSettings,
      registerCommands,
    ],
  );

  return (
    <QuickActionsContext.Provider value={contextValue}>
      {children}
      {paletteOpen ? (
        <Suspense fallback={<QuickActionsLoadingFallback />}>
          <QuickActionsPalette
            keyboard={keyboard}
            onClose={() => closePalette(true)}
            onExecute={(command) => {
              closePalette(false);
              window.requestAnimationFrame(() => executeCommand(command));
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
