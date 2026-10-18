import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { defaultAppPreferences, type AppPreferences } from "../../../src/types/appSettings";
import type { ArchiveScan } from "../../../src/storage/reconcileLibraryState";
import { shellStressThemes } from "../../fixtures/themes/shellStressThemes";
import { buildReaderFixture } from "../../fixtures/reader/readerFixtures";
import { emit } from "@tauri-apps/api/event";
import {
  APP_UPDATE_CHANGED_EVENT,
  type AppUpdateSnapshot,
} from "../../../src/features/updates/appUpdateTypes";

export const catalogSizes = [0, 2, 48, 49, 50, 500, 3000] as const;

/** Generated identities only. No file system, network archive or personal data access. */
export async function installUIStabilityBackend(params: URLSearchParams) {
  let count = Number(params.get("count") ?? 50);
  if (!catalogSizes.includes(count as (typeof catalogSizes)[number]))
    throw new Error("Unsupported catalog size");
  const archives = ["a", "b"].map((id) => ({
    id,
    displayName: `Synthetic ${id}`,
    rootPath: `fixture-${id}`,
    createdAt: "1",
    lastOpenedAt: "1",
  }));
  let active = "a";
  let revision = 0;
  const windowMode = params.get("window") ?? "main";
  if (!["main", "about", "settings", "archive-manager", "theme-manager"].includes(windowMode))
    throw new Error("Unsupported window mode");
  let nativeVisible = windowMode !== "main";
  const unexpected: string[] = [];
  let update: AppUpdateSnapshot = {
    revision: 1,
    supported: true,
    currentVersion: "1.7.0",
    status: "idle",
    available: null,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    prompt: {
      snoozedVersion: null,
      snoozedUntil: null,
      restartDeferred: false,
      completedVersion: null,
    },
  };
  const preferences: AppPreferences = structuredClone(defaultAppPreferences);
  preferences.automaticallyCheckForUpdates = false;
  preferences.rememberWindowState = false;
  preferences.restoreLastReader = false;
  preferences.showContinueReading = false;
  preferences.appearance.animationsEnabled = params.get("motion") !== "off";
  preferences.filesAndMetadata.liveWatcherEnabled = false;
  const theme = params.get("theme") ?? "dark";
  if (!["dark", "light", "system-light", "custom"].includes(theme))
    throw new Error("Unsupported theme");
  preferences.appTheme =
    theme === "custom"
      ? { kind: "custom", id: "shell-distinct" }
      : theme === "system-light"
        ? { kind: "system" }
        : { kind: "builtin", id: theme as "dark" | "light" };
  const readerTheme = params.get("reader") ?? "light";
  if (!["light", "dark", "sepia"].includes(readerTheme))
    throw new Error("Unsupported Reader theme");
  preferences.readerTheme = { kind: "builtin", id: readerTheme as "light" | "dark" | "sepia" };
  const epub = await buildReaderFixture("nested-prose");
  // Native storage supplies opaque raster bytes. SVG under an octet-stream Blob is not decodable.
  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Synthetic cover canvas is unavailable");
  context.fillStyle = "#607080";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const cover = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Synthetic PNG generation failed"))),
      "image/png",
    ),
  );
  const coverBytes = await cover.arrayBuffer();
  let metadata = { library: { version: 1, books: {} }, progress: { version: 1, progress: {} } };
  const registry = () => ({ version: 1, archives, lastOpenedArchiveId: active });
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  function scan(): ArchiveScan {
    return {
      folders: [],
      books: Array.from({ length: count }, (_, i) => ({
        discoveryId: `${active}-${i}`,
        relativePath: `Book-${String(i).padStart(4, "0")}.epub`,
        fileName: `Book-${String(i).padStart(4, "0")}.epub`,
        folderPath: "",
        size: epub.byteLength + i,
        modifiedAt: 1,
      })),
    };
  }
  Object.defineProperty(window, "isTauri", { value: true, configurable: true });
  mockWindows(windowMode);
  mockIPC(
    async (command, args) => {
      const input = args as Record<string, unknown>;
      switch (command) {
        case "load_app_settings_snapshot":
          await delay(80);
          return { revision, preferences };
        case "update_app_settings": {
          // Exercise the real normalization/mutation owner, preserving snapshot revisions.
          const { applyAppSettingsMutation } =
            await import("../../../src/stores/appPreferencesStore");
          const next = applyAppSettingsMutation(
            preferences,
            input.mutation as Parameters<typeof applyAppSettingsMutation>[1],
          );
          Object.assign(preferences, next);
          return { revision: ++revision, preferences };
        }
        case "load_archive_registry":
          return registry();
        case "validate_archive_path":
          return true;
        case "activate_archive":
          await delay(100);
          active = String(input.archiveId);
          metadata = { library: { version: 1, books: {} }, progress: { version: 1, progress: {} } };
          return registry();
        case "load_archive_metadata":
          return metadata;
        case "scan_archive":
          await delay(80);
          return scan();
        case "read_epub_file":
          await delay(100);
          return epub.buffer;
        case "load_epub_cover":
          return coverBytes;
        case "load_annotations_metadata":
          return { version: 1, books: {} };
        case "save_library_metadata":
          metadata.library = input.metadata as typeof metadata.library;
          return;
        case "save_progress_metadata":
          metadata.progress = input.metadata as typeof metadata.progress;
          return;
        case "save_annotations_metadata":
        case "initialize_archive_metadata":
        case "maintain_cover_cache":
          return;
        case "write_epub_metadata":
          await delay(400);
          throw new Error("Synthetic write failure; no file was changed");
        case "list_theme_packages":
          return ["shell-distinct"];
        case "read_theme_manifest":
          return JSON.stringify(shellStressThemes.distinct);
        case "load_theme_catalog_revision":
          return { revision: 0 };
        case "refresh_theme_catalog":
          return { revision: 0 };
        case "list_installed_font_families":
          return [];
        case "list_installed_dictionaries":
          return [];
        case "plugin:app|version":
          return "1.7.0";
        case "plugin:window|is_maximized":
          return false;
        case "plugin:window|scale_factor":
          return devicePixelRatio;
        case "plugin:window|is_visible":
          return nativeVisible;
        case "plugin:window|show":
          nativeVisible = true;
          return;
        case "plugin:window|hide":
          nativeVisible = false;
          return;
        case "plugin:window|set_focus":
          return;
        case "focus_main_window":
          nativeVisible = true;
          return;
        case "get_app_update_snapshot":
          return update;
        default:
          unexpected.push(command);
          throw new Error(`Unexpected stability fixture command: ${command}`);
      }
    },
    { shouldMockEvents: true },
  );
  return {
    unexpected,
    windowMode,
    preferences,
    async setUpdate(patch: Partial<AppUpdateSnapshot>) {
      update = { ...update, ...patch, revision: update.revision + 1 };
      await emit(APP_UPDATE_CHANGED_EVENT, update);
    },
    setCount(next: number) {
      if (!catalogSizes.includes(next as (typeof catalogSizes)[number]))
        throw new Error("Unsupported catalog size");
      count = next;
    },
    state: () => ({ archive: active, nativeVisible }),
  };
}
