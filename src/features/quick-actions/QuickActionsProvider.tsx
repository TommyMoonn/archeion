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
import { flushSync } from "react-dom";

import { router } from "../../app/router";
import { focusPresentationRuntime } from "../../app/inputModality";
import { DeferredTransientFallback } from "../../components/DeferredTransientFallback";
import { DialogLoadingFallback } from "../../components/DialogLoadingFallback";
import { captureFocusReturn, type FocusReturnRecord } from "../../utils/focusRestoration";
import { useKeyboardPreferences } from "../../stores/appPreferencesStore";
import { archiveStore } from "../../stores/archiveStore";
import type { AppCommand, KeyboardInteractionContext } from "../commands/appCommands";
import {
  commandDefinitions,
  effectiveKeyboardBinding,
  getConfigurableCommandDefinition,
} from "../commands/commandBindings";
import {
  createKeyboardInteractionContext,
  resolveKeyboardCommand,
} from "../commands/commandResolver";
import { QuickActionsRegistry, type QuickActionRegistration } from "./quickActions";
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
  const [palette, setPalette] = useState<{ focusReturn: FocusReturnRecord } | null>(null);
  const [settings, setSettings] = useState<{ focusReturn: FocusReturnRecord } | null>(null);
  const commandFocusReturnRef = useRef<FocusReturnRecord | null>(null);
  const keyboard = useKeyboardPreferences();
  const archive = useSyncExternalStore(
    archiveStore.subscribe,
    archiveStore.getSnapshot,
    archiveStore.getSnapshot,
  );

  const openPalette = useCallback(() => {
    setPalette({ focusReturn: commandFocusReturnRef.current ?? captureFocusReturn() });
  }, []);

  const preloadSettings = useCallback(() => {
    void loadSettingsDialog();
  }, []);

  const openSettings = useCallback(() => {
    preloadSettings();
    setSettings({ focusReturn: commandFocusReturnRef.current ?? captureFocusReturn() });
  }, [preloadSettings]);

  const executeCommand = useCallback(
    (command: AppCommand, focusReturn?: FocusReturnRecord) => {
      registry.recordRecent(command.id);
      commandFocusReturnRef.current = focusReturn ?? null;
      let result: void | Promise<void>;
      try {
        result = command.execute();
      } finally {
        commandFocusReturnRef.current = null;
      }
      void Promise.resolve(result).catch((error) => {
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

      focusPresentationRuntime.markKeyboardCommand();
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
    (sourceId: string, commands: readonly QuickActionRegistration[]) =>
      registry.register(sourceId, commands),
    [registry],
  );

  const appCommands = useMemo<QuickActionRegistration[]>(() => {
    const activeArchive = archive.status === "ready" ? archive.archive : null;
    const switchTargets = archive.archives.filter(
      (candidate) => candidate.id !== activeArchive?.id,
    );
    const switchCommands: QuickActionRegistration[] =
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
        availability: settings
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
  }, [archive, openPalette, openSettings, settings]);

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
      {palette ? (
        <Suspense fallback={<QuickActionsLoadingFallback />}>
          <QuickActionsPalette
            focusReturn={palette.focusReturn}
            keyboard={keyboard}
            onClose={() => setPalette(null)}
            onExecute={(command) => {
              flushSync(() => setPalette(null));
              executeCommand(command, palette.focusReturn);
            }}
            registry={registry}
          />
        </Suspense>
      ) : null}
      {settings ? (
        <Suspense fallback={<DialogLoadingFallback label="Opening settings" />}>
          <SettingsDialog focusReturn={settings.focusReturn} onClose={() => setSettings(null)} />
        </Suspense>
      ) : null}
    </QuickActionsContext.Provider>
  );
}

function QuickActionsLoadingFallback() {
  return (
    <DeferredTransientFallback>
      <div className="quick-actions-loading" role="status">
        <span>Opening Quick Actions</span>
      </div>
    </DeferredTransientFallback>
  );
}
