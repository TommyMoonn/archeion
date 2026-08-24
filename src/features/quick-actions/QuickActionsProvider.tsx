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
import { captureFocusReturn, type FocusReturnRecord } from "../../utils/focusRestoration";
import {
  appPreferencesStore,
  useAppPreferences,
  useKeyboardPreferences,
} from "../../stores/appPreferencesStore";
import { archiveStore, type ArchiveState } from "../../stores/archiveStore";
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
import { createDensityQuickActionMode } from "./quickActionDensityMode";
import { QuickActionChildModeSession, type QuickActionPaletteOutcome } from "./quickActionModes";
import {
  createThemeQuickActionMode,
  type QuickActionThemeModeServices,
} from "./quickActionThemeMode";
import { QuickActionsContext, type QuickActionsContextValue } from "./QuickActionsContext";
import { openSettingsWindow as openNativeSettingsWindow } from "../settings/settingsWindow";

const loadQuickActionsPalette = () =>
  import("./QuickActionsPalette").then((module) => ({ default: module.QuickActionsPalette }));
const QuickActionsPalette = lazy(loadQuickActionsPalette);
const quickActionsRegistry = new QuickActionsRegistry();

type QuickActionsProviderProps = {
  children: ReactNode;
  openSettingsWindow?: () => Promise<void>;
  themeModeServices?: QuickActionThemeModeServices;
};

export function QuickActionsProvider({
  children,
  openSettingsWindow = openNativeSettingsWindow,
  themeModeServices,
}: QuickActionsProviderProps) {
  const registry = quickActionsRegistry;
  const [palette, setPalette] = useState<{
    archiveId: string | null;
    focusReturn: FocusReturnRecord;
  } | null>(null);
  const [animationRetryTarget, setAnimationRetryTarget] = useState<boolean | null>(null);
  const commandFocusReturnRef = useRef<FocusReturnRecord | null>(null);
  const mountedRef = useRef(true);
  const preferences = useAppPreferences();
  const keyboard = useKeyboardPreferences();
  const archive = useSyncExternalStore(
    archiveStore.subscribe,
    archiveStore.getSnapshot,
    archiveStore.getSnapshot,
  );

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = appPreferencesStore.subscribe(() => {
      const animationsEnabled = appPreferencesStore.getSnapshot().appearance.animationsEnabled;
      setAnimationRetryTarget((currentTarget) =>
        currentTarget !== null && currentTarget !== animationsEnabled ? null : currentTarget,
      );
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const openPalette = useCallback(() => {
    setPalette({
      archiveId: archive.status === "ready" ? archive.archive.id : null,
      focusReturn: commandFocusReturnRef.current ?? captureFocusReturn(),
    });
  }, [archive]);

  const openSettings = useCallback(() => {
    void openSettingsWindow().catch((error) => {
      console.error("open_settings_window failed", error);
    });
  }, [openSettingsWindow]);

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

  useEffect(() => {
    const unsubscribe = archiveStore.subscribe(() => {
      const nextArchive = archiveStore.getSnapshot();
      setPalette((currentPalette) => {
        if (
          currentPalette?.archiveId &&
          nextArchive.status === "ready" &&
          nextArchive.archive.id !== currentPalette.archiveId
        ) {
          return null;
        }
        return currentPalette;
      });
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const registerCommands = useCallback(
    (sourceId: string, commands: readonly QuickActionRegistration[]) =>
      registry.register(sourceId, commands),
    [registry],
  );

  const appCommands = useMemo<QuickActionRegistration[]>(() => {
    const activeArchive = archive.status === "ready" ? archive.archive : null;
    const animationTarget = animationRetryTarget ?? !preferences.appearance.animationsEnabled;

    return [
      {
        ...commandDefinitions.quickActions,
        execute: openPalette,
        scope: "global",
        showInPalette: false,
      },
      {
        ...commandDefinitions.settings,
        availability: { available: true },
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
      {
        configuration: "unbound",
        execute: () => undefined,
        group: "Archive",
        id: "archive.switch",
        keywords: ["switch archive", "change archive"],
        label: "Switch archive…",
        order: 20,
        runInPalette: () => createArchiveSwitchMode(archive),
        scope: "global",
      },
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
      {
        availability: activeArchive
          ? { available: true }
          : { available: false, reason: "No archive is open." },
        configuration: "unbound",
        execute: () => undefined,
        group: "Appearance",
        id: "appearance.change-theme",
        keywords: ["theme", "appearance", "preview"],
        label: "Change theme…",
        order: 10,
        runInPalette: () => createThemeQuickActionMode(themeModeServices),
        scope: "global",
      },
      {
        configuration: "unbound",
        execute: () => undefined,
        group: "Appearance",
        id: "appearance.toggle-animations",
        keywords: ["animations", "motion", "transitions"],
        label:
          animationRetryTarget === null
            ? preferences.appearance.animationsEnabled
              ? "Turn animations off"
              : "Turn animations on"
            : animationTarget
              ? "Retry saving animations on"
              : "Retry saving animations off",
        order: 20,
        runInPalette: async () => {
          try {
            await appPreferencesStore.update({
              appearance: {
                animationsEnabled: animationTarget,
              },
            });
            if (mountedRef.current) setAnimationRetryTarget(null);
            return { kind: "close" };
          } catch {
            if (
              appPreferencesStore.getSnapshot().appearance.animationsEnabled !== animationTarget
            ) {
              if (mountedRef.current) setAnimationRetryTarget(null);
              return { kind: "keep-open" };
            }
            if (mountedRef.current) setAnimationRetryTarget(animationTarget);
            return {
              error: `Animations are ${animationTarget ? "on" : "off"} for this session but could not be saved. Retry to keep this setting after Archeion closes.`,
              kind: "keep-open",
            };
          }
        },
        scope: "global",
      },
      {
        configuration: "unbound",
        execute: () => undefined,
        group: "Appearance",
        id: "appearance.change-density",
        keywords: ["display density", "comfortable", "compact", "spacing"],
        label: "Change display density…",
        order: 30,
        runInPalette: () =>
          createDensityQuickActionMode(preferences.density, (density) =>
            appPreferencesStore.update({ density }),
          ),
        scope: "global",
      },
    ];
  }, [animationRetryTarget, archive, openPalette, openSettings, preferences, themeModeServices]);

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
      registerCommands,
    }),
    [getCommandBinding, handleKeyboardEvent, openPalette, openSettings, registerCommands],
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
              if (command.runInPalette) {
                return command.runInPalette();
              }
              flushSync(() => setPalette(null));
              executeCommand(command, palette.focusReturn);
              return { kind: "close" };
            }}
            registry={registry}
          />
        </Suspense>
      ) : null}
    </QuickActionsContext.Provider>
  );
}

function createArchiveSwitchMode(archive: ArchiveState): QuickActionPaletteOutcome {
  const activeArchiveId = archive.status === "ready" ? archive.archive.id : undefined;
  const hasSwitchTarget = archive.archives.some((candidate) => candidate.id !== activeArchiveId);

  return {
    kind: "child-mode",
    mode: new QuickActionChildModeSession({
      confirm: async (option) => {
        const switched = await archiveStore.switchArchive(option.id);
        if (!switched) {
          return {
            error:
              "Archive could not be opened. Check that its folder is available, then try again.",
            kind: "keep-open",
          };
        }
        await router.navigate("/", { replace: true });
        return { kind: "close" };
      },
      id: "archive-switch",
      placeholder: "Search archives…",
      snapshot: {
        committedOptionId: activeArchiveId,
        options: archive.archives.map((candidate) => ({
          availability:
            candidate.id === activeArchiveId
              ? { available: false, reason: "Current archive" }
              : { available: true },
          id: candidate.id,
          keywords: [candidate.rootPath],
          label: candidate.displayName,
          status: candidate.id === activeArchiveId ? "Current archive" : undefined,
        })),
        unavailableReason: hasSwitchTarget ? undefined : "No other known archives are available.",
      },
      title: "Switch archive",
    }),
  };
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
