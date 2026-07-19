import type { LibraryStorage } from "../storage/LibraryStorage";
import { getLibraryStorage } from "../storage/defaultLibraryStorage";
import { appPreferencesStore } from "../stores/appPreferencesStore";
import { archiveStore } from "../stores/archiveStore";
import type { AppPreferences } from "../types/appSettings";
import type { ArchiveState } from "../stores/archiveStore";
import type { Book } from "../types/book";
import { canonicalReaderRoute } from "./navigationState";
import { startupTrace } from "./startupTrace";
import { restoreMainWindowState } from "./windowState";

export type PreparedArchiveStorage = {
  archiveId: string;
  rootPath: string;
  storage: LibraryStorage;
};

export type MainStartupResult =
  | {
      preparedArchive: null;
      restoredReader: false;
      showArchiveManager: true;
    }
  | {
      preparedArchive: PreparedArchiveStorage;
      restoredReader: boolean;
      showArchiveManager: false;
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
  getStorage: () => Promise<LibraryStorage>;
  initializeArchiveRegistry: () => Promise<void>;
  initializePreferences: () => Promise<void>;
  onArchiveManagerOpened: () => void;
  openArchiveManagerWindow: () => Promise<boolean>;
  restoreReaderRoute: (preferences: AppPreferences, storage: LibraryStorage) => Promise<boolean>;
  restoreWindowState: (preferences: AppPreferences) => Promise<boolean>;
};

type MainStartupOptions = Pick<MainStartupDependencies, "restoreReaderRoute"> &
  Partial<Omit<MainStartupDependencies, "restoreReaderRoute">>;

type ResumeInitialStartupDependencies = {
  getArchiveState: () => ArchiveState;
  getStorage: () => Promise<LibraryStorage>;
  isCurrentAttempt?: () => boolean;
  navigateToLibrary: () => Promise<unknown>;
  refreshActiveArchive: () => Promise<boolean>;
};

type ArchiveManagerStartupDependencies = Pick<
  MainStartupDependencies,
  "initializeArchiveRegistry" | "initializePreferences"
>;

type ReaderRestoreStorage = {
  getBook: (bookId: string) => Promise<Book | undefined>;
};

type ReaderRestoreDependencies = {
  clearNavigation: () => Promise<void>;
  getArchiveState: () => ArchiveState;
  getCurrentPathname: () => string;
  navigate: (path: string) => Promise<unknown>;
};

type ReaderRestoreOptions = Pick<ReaderRestoreDependencies, "navigate"> &
  Partial<Omit<ReaderRestoreDependencies, "navigate">>;

async function clearRememberedNavigation(): Promise<void> {
  if (appPreferencesStore.getSnapshot().navigation) {
    await appPreferencesStore.update({ navigation: null });
  }
}

async function navigateToLibraryIfNeeded(
  dependencies: Pick<ReaderRestoreDependencies, "getCurrentPathname" | "navigate">,
): Promise<void> {
  if (dependencies.getCurrentPathname() !== "/") {
    await dependencies.navigate("/");
  }
}

export async function restoreRememberedReaderRoute(
  preferences: AppPreferences,
  storage: ReaderRestoreStorage,
  options: ReaderRestoreOptions,
): Promise<boolean> {
  const dependencies: ReaderRestoreDependencies = {
    clearNavigation: clearRememberedNavigation,
    getArchiveState: archiveStore.getSnapshot,
    getCurrentPathname: () => window.location.pathname,
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
    await navigateToLibraryIfNeeded(dependencies);
    return false;
  }

  try {
    const book = await storage.getBook(remembered.bookId);
    if (!book || book.isFileMissing) {
      throw new Error("The remembered book is unavailable.");
    }

    await dependencies.navigate(canonicalReaderRoute(book.id));
    return true;
  } catch {
    await dependencies.clearNavigation().catch(() => undefined);
    await navigateToLibraryIfNeeded(dependencies);
    return false;
  }
}

const defaultDependencies: Omit<MainStartupDependencies, "restoreReaderRoute"> = {
  getArchiveState: archiveStore.getSnapshot,
  getPreferences: appPreferencesStore.getSnapshot,
  getStorage: getLibraryStorage,
  initializeArchiveRegistry: () => archiveStore.initialize(),
  initializePreferences: () => appPreferencesStore.initialize(),
  onArchiveManagerOpened: () => undefined,
  openArchiveManagerWindow: () => archiveStore.openArchiveManagerWindow(),
  restoreWindowState: restoreMainWindowState,
};

const defaultArchiveManagerDependencies: ArchiveManagerStartupDependencies = {
  initializeArchiveRegistry: defaultDependencies.initializeArchiveRegistry,
  initializePreferences: defaultDependencies.initializePreferences,
};

async function prepareArchiveStorageIfCurrent(
  archive: ArchiveState,
  getStorage: () => Promise<LibraryStorage>,
  isCurrentAttempt: () => boolean,
): Promise<PreparedArchiveStorage | null> {
  if (archive.status !== "ready") {
    throw new Error("The active archive was not resolved before storage preparation.");
  }

  if (!isCurrentAttempt()) return null;

  const storage = await getStorage();
  if (!isCurrentAttempt()) return null;

  storage.reset(archive.path);
  startupTrace.mark("storage");
  return { archiveId: archive.archive.id, rootPath: archive.path, storage };
}

async function prepareArchiveStorage(
  archive: ArchiveState,
  getStorage: () => Promise<LibraryStorage>,
): Promise<PreparedArchiveStorage> {
  const preparedArchive = await prepareArchiveStorageIfCurrent(archive, getStorage, () => true);
  if (!preparedArchive) {
    throw new Error("Startup storage preparation was cancelled unexpectedly.");
  }
  return preparedArchive;
}

export async function initializeArchiveManagerStartup(
  dependencyOverrides: Partial<ArchiveManagerStartupDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultArchiveManagerDependencies, ...dependencyOverrides };
  await Promise.all([
    dependencies.initializePreferences().then(() => startupTrace.mark("preferences")),
    dependencies.initializeArchiveRegistry().then(() => startupTrace.mark("archive")),
  ]);
}

export async function initializeMainStartup(
  dependencyOverrides: MainStartupOptions,
): Promise<MainStartupResult> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const preferencesTask = dependencies.initializePreferences().then(() => {
    startupTrace.mark("preferences");
    return dependencies.getPreferences();
  });
  const archiveTask = dependencies.initializeArchiveRegistry().then(() => {
    startupTrace.mark("archive");
    return dependencies.getArchiveState();
  });
  const windowTask = preferencesTask.then(async (preferences) => {
    await dependencies.restoreWindowState(preferences);
    startupTrace.mark("window");
  });
  const [preferences, archive] = await Promise.all([preferencesTask, archiveTask, windowTask]);

  const showArchiveManager =
    preferences.startupBehavior === "show-archive-manager" || archive.status !== "ready";

  if (showArchiveManager) {
    if (!(await dependencies.openArchiveManagerWindow())) {
      throw new StartupArchiveManagerOpenError();
    }
    dependencies.onArchiveManagerOpened();
    return { preparedArchive: null, restoredReader: false, showArchiveManager: true };
  }

  const preparedArchive = await prepareArchiveStorage(archive, dependencies.getStorage);
  const restoredReader = await dependencies.restoreReaderRoute(
    preferences,
    preparedArchive.storage,
  );
  return { preparedArchive, restoredReader, showArchiveManager: false };
}

export async function resumeInitialStartupAfterArchiveManagerClose({
  getArchiveState,
  getStorage,
  isCurrentAttempt = () => true,
  navigateToLibrary,
  refreshActiveArchive,
}: ResumeInitialStartupDependencies): Promise<PreparedArchiveStorage | null> {
  if (!(await refreshActiveArchive())) {
    return null;
  }

  if (!isCurrentAttempt()) return null;

  const preparedArchive = await prepareArchiveStorageIfCurrent(
    getArchiveState(),
    getStorage,
    isCurrentAttempt,
  );
  if (!preparedArchive || !isCurrentAttempt()) return null;

  await navigateToLibrary();
  return isCurrentAttempt() ? preparedArchive : null;
}
