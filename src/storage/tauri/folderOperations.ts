import type { CreateFolderInput, Folder, UpdateFolderInput } from "../../types/folder";
import type { ArchivePathChange } from "../LibraryStorage";
import {
  type ArchiveCommandScope,
  type StorageOperationHost,
  isInsideFolderPath,
  replacePathPrefix,
  requireFolder,
} from "./operationTypes";

export class FolderOperations {
  constructor(private readonly host: StorageOperationHost) {}

  async createFolder(input: CreateFolderInput): Promise<Folder> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const parentRelativePath = input.parentId
      ? requireFolder(this.host, input.parentId).relativePath
      : undefined;
    const relativePath = await this.host.commands.invoke(
      "create_archive_folder",
      { parentRelativePath, name: input.name },
      scope.rootPath,
    );

    this.host.assertCurrentScope(scope);
    await this.host.rescan();
    const folder = this.host
      .getFolders()
      .find((candidate) => candidate.relativePath === relativePath);
    if (!folder) {
      throw new Error("The new folder could not be found after rescan.");
    }
    return folder;
  }

  async getFolder(id: string): Promise<Folder | undefined> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    return this.host.getFolders().find((folder) => folder.id === id);
  }

  async listFolders(): Promise<Folder[]> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    return [...this.host.getFolders()];
  }

  async updateFolder(id: string, changes: UpdateFolderInput): Promise<Folder | undefined> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const folder = requireFolder(this.host, id);
    const changesParent = Object.hasOwn(changes, "parentId");
    const changesName = Object.hasOwn(changes, "name");

    if (changesParent && changesName) {
      throw new Error("Rename and move folders as separate operations.");
    }

    if (changesName) {
      const newName = changes.name;
      if (!newName) {
        throw new Error("Folder name is required.");
      }
      const change = await this.host.commands.invoke(
        "rename_archive_folder",
        { relativePath: folder.relativePath, newName },
        scope.rootPath,
      );
      return this.applyFolderPathChange(change, scope);
    }

    if (changesParent) {
      const destinationParentPath = changes.parentId
        ? requireFolder(this.host, changes.parentId).relativePath
        : undefined;
      const change = await this.host.commands.invoke(
        "move_archive_folder",
        { relativePath: folder.relativePath, destinationParentPath },
        scope.rootPath,
      );
      return this.applyFolderPathChange(change, scope);
    }

    return folder;
  }

  async revealFolder(id: string): Promise<void> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const folder = requireFolder(this.host, id);
    await this.host.commands.invoke(
      "reveal_archive_folder",
      { relativePath: folder.relativePath },
      scope.rootPath,
    );
  }

  async deleteFolder(id: string): Promise<boolean> {
    const scope = this.host.createScope();
    const loading = this.host.ensureLoadedOrPromise(scope);
    if (loading) await loading;
    const index = this.host.getFolders().findIndex((folder) => folder.id === id);
    if (index < 0) {
      return false;
    }

    const folder = requireFolder(this.host, id);
    await this.host.commands.invoke(
      "delete_archive_folder",
      { relativePath: folder.relativePath },
      scope.rootPath,
    );
    if (!this.host.isCurrentScope(scope)) {
      return false;
    }

    for (const [bookId, entry] of Object.entries(this.host.getLibraryMetadata().books)) {
      if (isInsideFolderPath(entry.relativePath, folder.relativePath)) {
        delete this.host.getLibraryMetadata().books[bookId];
        delete this.host.getProgressMetadata().progress[bookId];
      }
    }
    await this.host.saveMetadata(scope, { library: true, progress: true });
    await this.host.rescan();
    return true;
  }

  private async applyFolderPathChange(
    change: ArchivePathChange,
    scope: ArchiveCommandScope,
  ): Promise<Folder | undefined> {
    if (!this.host.isCurrentScope(scope)) {
      return undefined;
    }

    const timestamp = new Date().toISOString();
    for (const [id, entry] of Object.entries(this.host.getLibraryMetadata().books)) {
      if (!isInsideFolderPath(entry.relativePath, change.oldRelativePath)) {
        continue;
      }
      this.host.getLibraryMetadata().books[id] = {
        ...entry,
        relativePath: replacePathPrefix(
          entry.relativePath,
          change.oldRelativePath,
          change.newRelativePath,
        ),
        updatedAt: timestamp,
      };
    }

    await this.host.saveMetadata(scope, { library: true });
    if (!this.host.isCurrentScope(scope)) {
      return undefined;
    }
    await this.host.rescan();
    return this.host.getFolders().find((folder) => folder.relativePath === change.newRelativePath);
  }
}
