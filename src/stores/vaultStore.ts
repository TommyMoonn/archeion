import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type VaultState =
  | { status: "loading"; path: null; error: null }
  | { status: "setup"; path: null; error: null }
  | { status: "ready"; path: string; error: null; watcherError: string | null }
  | { status: "missing"; path: string; error: null }
  | { status: "error"; path: string | null; error: string };

type Listener = () => void;

export class VaultStore {
  private state: VaultState = {
    status: "loading",
    path: null,
    error: null,
  };
  private listeners = new Set<Listener>();
  private initialization: Promise<void> | null = null;

  getSnapshot = (): VaultState => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize(): Promise<void> {
    if (this.initialization) {
      return this.initialization;
    }

    this.initialization = this.loadSavedVault();
    return this.initialization;
  }

  async chooseVault(): Promise<boolean> {
    if (!isTauri()) {
      this.setState({
        status: "error",
        path: this.state.path,
        error: "Library folders can only be opened in the desktop app.",
      });
      return false;
    }

    let selected: string | string[] | null;

    try {
      selected = await open({
        directory: true,
        multiple: false,
        title: "Open EPUB library folder",
      });
    } catch {
      this.setState({
        status: "error",
        path: this.state.path,
        error: "The folder picker could not be opened.",
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

    return this.useVault(path);
  }

  async retry(): Promise<void> {
    if (!this.state.path) {
      this.setState({ status: "setup", path: null, error: null });
      return;
    }

    await this.useVault(this.state.path);
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

  private async loadSavedVault(): Promise<void> {
    if (!isTauri()) {
      this.setState({
        status: "error",
        path: null,
        error: "Library folders can only be opened in the desktop app.",
      });
      return;
    }

    let path: string | null;

    try {
      path = await invoke<string | null>("load_vault_path");
    } catch {
      this.setState({
        status: "error",
        path: null,
        error: "The saved library folder could not be read.",
      });
      return;
    }

    if (!path) {
      this.setState({ status: "setup", path: null, error: null });
      return;
    }

    await this.useVault(path);
  }

  private async useVault(path: string): Promise<boolean> {
    this.setState({ status: "loading", path: null, error: null });

    try {
      const exists = await invoke<boolean>("validate_vault_path", { path });

      if (!exists) {
        this.setState({ status: "missing", path, error: null });
        return false;
      }

      await invoke("save_vault_path", { path });
      await invoke("initialize_vault_metadata");
      this.setState({ status: "ready", path, error: null, watcherError: null });
      return true;
    } catch {
      this.setState({
        status: "error",
        path,
        error: "The library folder could not be accessed.",
      });
      return false;
    }
  }

  private setState(state: VaultState) {
    this.state = state;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const vaultStore = new VaultStore();
