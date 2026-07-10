import { getLibraryStorage } from "../storage/defaultLibraryStorage";
import { appPreferencesStore } from "../stores/appPreferencesStore";
import { archiveStore } from "../stores/archiveStore";
import type { AppPreferences } from "../types/appSettings";
import type { ArchiveState } from "../stores/archiveStore";
import type { Book } from "../types/book";
import { canonicalReaderRoute } from "./navigationState";
import { restoreMainWindowState } from "./windowState";

export type MainStartupResult = {
  restoredReader: boolean;
  showArchiveManager: boolean;
};

export class StartupArchiveManagerOpenError extends Error {
  constructor() {
    super("Archive Manager window failed to open.");
    this.name = "StartupArchiveManagerOpenError";
  }
}

type MainStartupDependencies = {
  getPreferences: () => AppPreferences;
  getArchiveState: () => ArchiveState;
  initializeArchiveRegistry: () => Promise<void>;
  initializePreferences: () => Promise<void>;
  openArchiveManagerWindow: () => Promise<boolean>;
  restoreReaderRoute: (preferences: AppPreferences) => Promise<boolean>;
  restoreWindowState: (preferences: AppPreferences) => Promise<boolean>;
};

type MainStartupOptions = Pick<MainStartupDependencies, "restoreReaderRoute"> &
  Partial<Omit<MainStartupDependencies, "restoreReaderRoute">>;

type ResumeMainStartupDependencies = {
  navigateToLibrary: () => Promise<unknown>;
  refreshActiveArchive: () => Promise<boolean>;
};

type ReaderRestoreStorage = {
  getBook: (bookId: string) => Promise<Book | undefined>;
  loadBookFile: (bookId: string) => Promise<Blob>;
  reset: (archiveRootPath: string | null) => void;
};

type ReaderRestoreDependencies = {
  clearNavigation: () => Promise<void>;
  getArchiveState: () => ArchiveState;
  getStorage: () => Promise<ReaderRestoreStorage>;
  navigate: (path: string) => Promise<unknown>;
};

type ReaderRestoreOptions = Pick<ReaderRestoreDependencies, "navigate"> &
  Partial<Omit<ReaderRestoreDependencies, "navigate">>;

async function clearRememberedNavigation(): Promise<void> {
  if (appPreferencesStore.getSnapshot().navigation) {
    await appPreferencesStore.update({ navigation: null });
  }
}

export async function restoreRememberedReaderRoute(
  preferences: AppPreferences,
  options: ReaderRestoreOptions,
): Promise<boolean> {
  const dependencies: ReaderRestoreDependencies = {
    clearNavigation: clearRememberedNavigation,
    getArchiveState: archiveStore.getSnapshot,
    getStorage: getLibraryStorage,
    ...options,
  };
  const archive = dependencies.getArchiveState();
  const remembered = preferences.navigation;

  if (
    !preferences.restoreLastReader ||
    !remembered ||
    archive.status !== "ready" ||
    archive.archive.id !== remembered.archiveId
  ) {
    if (remembered && archive.status === "ready" && archive.archive.id !== remembered.archiveId) {
      await dependencies.clearNavigation().catch(() => undefined);
    }
    await dependencies.navigate("/");
    return false;
  }

  try {
    const storage = await dependencies.getStorage();
    storage.reset(archive.path);
    const book = await storage.getBook(remembered.bookId);
    if (!book || book.isFileMissing) {
      throw new Error("The remembered book is unavailable.");
    }

    await storage.loadBookFile(book.id);
    await dependencies.navigate(canonicalReaderRoute(book.id));
    return true;
  } catch {
    await dependencies.clearNavigation().catch(() => undefined);
    await dependencies.navigate("/");
    return false;
  }
}

const defaultDependencies: Omit<MainStartupDependencies, "restoreReaderRoute"> = {
  getArchiveState: archiveStore.getSnapshot,
  getPreferences: appPreferencesStore.getSnapshot,
  initializeArchiveRegistry: () => archiveStore.initialize(),
  initializePreferences: () => appPreferencesStore.initialize(),
  openArchiveManagerWindow: () => archiveStore.openArchiveManagerWindow(),
  restoreWindowState: restoreMainWindowState,
};

export async function initializeMainStartup(
  dependencyOverrides: MainStartupOptions,
): Promise<MainStartupResult> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  await dependencies.initializePreferences();
  const preferences = dependencies.getPreferences();
  await dependencies.initializeArchiveRegistry();

  const showArchiveManager =
    preferences.startupBehavior === "show-archive-manager" ||
    dependencies.getArchiveState().status !== "ready";
  await dependencies.restoreWindowState(preferences);

  if (showArchiveManager) {
    if (!(await dependencies.openArchiveManagerWindow())) {
      throw new StartupArchiveManagerOpenError();
    }
    return { restoredReader: false, showArchiveManager: true };
  }

  const restoredReader = await dependencies.restoreReaderRoute(preferences);
  return { restoredReader, showArchiveManager: false };
}

export async function resumeMainStartupAfterArchiveManagerClose({
  navigateToLibrary,
  refreshActiveArchive,
}: ResumeMainStartupDependencies): Promise<boolean> {
  if (!(await refreshActiveArchive())) {
    return false;
  }

  await navigateToLibrary();
  return true;
}
