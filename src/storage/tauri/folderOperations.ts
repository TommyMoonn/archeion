import type { CreateFolderInput, Folder, UpdateFolderInput } from "../../types/folder";
import type { ArchivePathChange } from "../LibraryStorage";
import {
  type ArchiveCommandScope,
  type StorageOperationHost,
  WatcherSuppressionGroup,
  reportArchiveCacheWarning,
  reportArchiveMetadataRecoveryWarning,
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
    const suppression = new WatcherSuppressionGroup(scope.rootPath);
    const predictedPath = parentRelativePath
      ? `${parentRelativePath}/${input.name.trim()}`
      : input.name.trim();
    suppression.begin(predictedPath);
    try {
      const relativePath = await this.host.commands.invoke(
        "create_archive_folder",
        { parentRelativePath, name: input.name },
        scope.rootPath,
      );

      this.host.assertCurrentScope(scope);
      suppression.addPath(relativePath);
      await this.host.applyArchiveDelta(scope, { kind: "create-folder", relativePath });
      const folder = this.host
        .getFolders()
        .find((candidate) => candidate.relativePath === relativePath);
      if (!folder) {
        throw new Error("The new folder could not be applied to the archive model.");
      }
      return folder;
    } finally {
      suppression.finish();
    }
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
      return this.runFolderPathOperation(scope, folder.relativePath, () =>
        this.host.commands.invoke(
          "rename_archive_folder",
          { relativePath: folder.relativePath, newName },
          scope.rootPath,
        ),
      );
    }

    if (changesParent) {
      const destinationParentPath = changes.parentId
        ? requireFolder(this.host, changes.parentId).relativePath
        : undefined;
      return this.runFolderPathOperation(scope, folder.relativePath, () =>
        this.host.commands.invoke(
          "move_archive_folder",
          { relativePath: folder.relativePath, destinationParentPath },
          scope.rootPath,
        ),
      );
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
    const suppression = new WatcherSuppressionGroup(scope.rootPath);
    suppression.begin(folder.relativePath);
    try {
      const result = await this.host.commands.invoke(
        "delete_archive_folder",
        { relativePath: folder.relativePath },
        scope.rootPath,
      );
      if (!this.host.isCurrentScope(scope)) {
        return false;
      }
      reportArchiveCacheWarning(this.host, result);

      try {
        await this.host.applyArchiveDelta(scope, {
          kind: "remove-folder",
          relativePath: folder.relativePath,
        });
      } catch (error) {
        if (this.host.isCurrentScope(scope)) {
          reportArchiveMetadataRecoveryWarning(this.host, "The folder deletion", error);
        }
        return true;
      }
      return true;
    } finally {
      suppression.finish();
    }
  }

  private async runFolderPathOperation(
    scope: ArchiveCommandScope,
    relativePath: string,
    operation: () => Promise<ArchivePathChange>,
  ): Promise<Folder | undefined> {
    const suppression = new WatcherSuppressionGroup(scope.rootPath);
    suppression.begin(relativePath);
    try {
      const change = await operation();
      suppression.addPath(change.newRelativePath);
      if (!this.host.isCurrentScope(scope)) {
        return undefined;
      }
      reportArchiveCacheWarning(this.host, change);
      await this.host.applyArchiveDelta(scope, {
        kind: "folder-path",
        oldRelativePath: change.oldRelativePath,
        newRelativePath: change.newRelativePath,
      });
      return this.host
        .getFolders()
        .find((folder) => folder.relativePath === change.newRelativePath);
    } finally {
      suppression.finish();
    }
  }
}
