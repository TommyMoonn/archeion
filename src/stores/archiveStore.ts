import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { ArchiveRegistry, KnownArchive } from "../types/archive";
import { activeArchiveFromRegistry } from "../types/archive";

export type ArchiveState =
  | { status: "loading"; path: null; error: null; archives: KnownArchive[] }
  | { status: "setup"; path: null; error: null; archives: KnownArchive[] }
  | {
      status: "ready";
      path: string;
      archive: KnownArchive;
      error: null;
      watcherError: string | null;
      archives: KnownArchive[];
    }
  | {
      status: "missing";
      path: string;
      archive: KnownArchive | null;
      error: null;
      archives: KnownArchive[];
    }
  | {
      status: "error";
      path: string | null;
      error: string;
      archives: KnownArchive[];
    };

type Listener = () => void;

type ArchiveFolderPickerOptions = {
  title: string;
};

function setupState(archives: KnownArchive[]): ArchiveState {
  return { status: "setup", path: null, error: null, archives };
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export class ArchiveStore {
  private state: ArchiveState = {
    status: "loading",
    path: null,
    error: null,
    archives: [],
  };
  private listeners = new Set<Listener>();
  private initialization: Promise<void> | null = null;

  getSnapshot = (): ArchiveState => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize(): Promise<void> {
    if (this.initialization) {
      return this.initialization;
    }

    this.initialization = this.loadSavedArchive();
    return this.initialization;
  }

  chooseArchive(): Promise<boolean> {
    return this.chooseArchiveFolder({ title: "Open folder as archive" });
  }

  createArchive(): Promise<boolean> {
    return this.chooseArchiveFolder({ title: "Create empty archive" });
  }

  async openArchivePath(path: string): Promise<boolean> {
    this.setState({
      status: "loading",
      path: null,
      error: null,
      archives: this.state.archives,
    });

    try {
      const registry = await invoke<ArchiveRegistry>("open_archive", { path });
      return await this.useRegistryActiveArchive(registry);
    } catch (error) {
      const message = errorMessage(error, "The archive folder could not be opened.");
      console.error("open_archive failed", error);
      this.setState({
        status: "error",
        path,
        error: message,
        archives: this.state.archives,
      });
      return false;
    }
  }

  async switchArchive(archiveId: string): Promise<boolean> {
    const archives = this.state.archives;
    this.setState({
      status: "loading",
      path: null,
      error: null,
      archives,
    });

    try {
      const registry = await invoke<ArchiveRegistry>("activate_archive", {
        archiveId,
      });
      return await this.useRegistryActiveArchive(registry);
    } catch (error) {
      const archive = archives.find((candidate) => candidate.id === archiveId);
      console.error("activate_archive failed", error);
      if (archive) {
        this.setState({
          status: "missing",
          path: archive.rootPath,
          archive,
          error: null,
          archives,
        });
      } else {
        this.setState({
          status: "error",
          path: null,
          error: errorMessage(error, "The archive could not be opened."),
          archives,
        });
      }
      return false;
    }
  }

  async renameArchive(archiveId: string, displayName: string): Promise<boolean> {
    try {
      const registry = await invoke<ArchiveRegistry>("rename_archive", {
        archiveId,
        displayName,
      });
      this.applyRegistry(registry);
      return true;
    } catch (error) {
      console.error("rename_archive failed", error);
      return false;
    }
  }

  async forgetArchive(archiveId: string): Promise<boolean> {
    try {
      const registry = await invoke<ArchiveRegistry>("forget_archive", {
        archiveId,
      });
      this.applyRegistry(registry);
      return true;
    } catch (error) {
      console.error("forget_archive failed", error);
      return false;
    }
  }

  async revealArchive(archiveId: string): Promise<boolean> {
    try {
      await invoke("reveal_archive", { archiveId });
      return true;
    } catch (error) {
      console.error("reveal_archive failed", error);
      return false;
    }
  }

  async retry(): Promise<void> {
    if (this.state.status === "missing" && this.state.archive) {
      await this.switchArchive(this.state.archive.id);
      return;
    }

    this.setState(setupState(this.state.archives));
  }

  setWatcherError(error: string | null): void {
    if (this.state.status !== "ready") {
      return;
    }

    if (this.state.watcherError === error) {
      return;
    }

    this.setState({ ...this.state, watcherError: error });
  }

  private async chooseArchiveFolder({
    title,
  }: ArchiveFolderPickerOptions): Promise<boolean> {
    if (!isTauri()) {
      this.setState({
        status: "error",
        path: this.state.path,
        error: "Archive folders can only be opened in the desktop app.",
        archives: this.state.archives,
      });
      return false;
    }

    let selected: string | string[] | null;

    try {
      selected = await open({
        directory: true,
        multiple: false,
        title,
      });
    } catch (error) {
      console.error("archive folder picker failed", error);
      this.setState({
        status: "error",
        path: this.state.path,
        error: errorMessage(error, "The folder picker could not be opened."),
        archives: this.state.archives,
      });
      return false;
    }

    if (selected === null) {
      return false;
    }

    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) {
      return false;
    }

    return this.openArchivePath(path);
  }

  private async loadSavedArchive(): Promise<void> {
    if (!isTauri()) {
      this.setState({
        status: "error",
        path: null,
        error: "Archive folders can only be opened in the desktop app.",
        archives: [],
      });
      return;
    }

    let registry: ArchiveRegistry;

    try {
      registry = await invoke<ArchiveRegistry>("load_archive_registry");
    } catch (error) {
      console.error("load_archive_registry failed", error);
      this.setState({
        status: "error",
        path: null,
        error: errorMessage(error, "The archive registry could not be read."),
        archives: [],
      });
      return;
    }

    const active = activeArchiveFromRegistry(registry);
    if (!active) {
      this.setState(setupState(registry.archives));
      return;
    }

    await this.useRegistryActiveArchive(registry);
  }

  private async useRegistryActiveArchive(
    registry: ArchiveRegistry,
  ): Promise<boolean> {
    const active = activeArchiveFromRegistry(registry);
    if (!active) {
      this.setState(setupState(registry.archives));
      return false;
    }

    try {
      const exists = await invoke<boolean>("validate_archive_path", {
        path: active.rootPath,
      });

      if (!exists) {
        this.setState({
          status: "missing",
          path: active.rootPath,
          archive: active,
          error: null,
          archives: registry.archives,
        });
        return false;
      }

      await invoke("initialize_archive_metadata", { rootPath: active.rootPath });
      this.setState({
        status: "ready",
        path: active.rootPath,
        archive: active,
        error: null,
        watcherError: null,
        archives: registry.archives,
      });
      return true;
    } catch (error) {
      console.error("archive activation failed", error);
      this.setState({
        status: "error",
        path: active.rootPath,
        error: errorMessage(error, "The archive folder could not be accessed."),
        archives: registry.archives,
      });
      return false;
    }
  }

  private applyRegistry(registry: ArchiveRegistry) {
    const current = this.state;

    if (current.status === "ready") {
      const active = registry.archives.find(
        (archive) => archive.id === current.archive.id,
      );
      if (active) {
        this.setState({
          ...current,
          path: active.rootPath,
          archive: active,
          archives: registry.archives,
        });
        return;
      }
    }

    if (current.status === "missing" && current.archive) {
      const active = registry.archives.find(
        (archive) => archive.id === current.archive?.id,
      );
      if (active) {
        this.setState({
          ...current,
          path: active.rootPath,
          archive: active,
          archives: registry.archives,
        });
        return;
      }
    }

    const active = activeArchiveFromRegistry(registry);
    if (!active) {
      this.setState(setupState(registry.archives));
      return;
    }

    this.setState({
      ...this.state,
      archives: registry.archives,
    });
  }

  private setState(state: ArchiveState) {
    this.state = state;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const archiveStore = new ArchiveStore();
