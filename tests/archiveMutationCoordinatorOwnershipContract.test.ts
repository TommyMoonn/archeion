import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const coordinatorSource = readSource("src/storage/archiveMutationCoordinator.ts");
const facadeSource = readSource("src/storage/TauriArchiveLibraryStorage.ts");
const operationTypesSource = readSource("src/storage/tauri/operationTypes.ts");

describe("Phase 0.9.0.20 archive mutation coordinator ownership", () => {
  it("gives one coordinator the archive model commit and publication mechanics", () => {
    expect(coordinatorSource).toContain("export class ArchiveMutationCoordinator");
    expect(coordinatorSource).toContain("private commitQueue: Promise<void>");
    expect(coordinatorSource).toContain("commitArchiveStateMutation<T>");
    expect(coordinatorSource).toContain("commitArchiveDelta(");
    expect(coordinatorSource).toContain("commitFullScan(");
    expect(coordinatorSource).toContain("reduceArchiveModel(");
    expect(coordinatorSource).toContain("validateTargetedArchiveScan(");
    expect(coordinatorSource).toContain("private publishLibrarySnapshot(");
    expect(coordinatorSource.match(/private commitQueue:/g)).toHaveLength(1);
  });

  it("keeps the storage facade as the public delegating boundary", () => {
    expect(facadeSource).toContain(
      "private readonly mutationCoordinator: ArchiveMutationCoordinator",
    );
    expect(facadeSource).toContain("new ArchiveMutationCoordinator({");
    expect(facadeSource).toContain(
      "this.mutationCoordinator.commitArchiveStateMutation(scope, mutation)",
    );
    expect(facadeSource).toContain(
      "this.mutationCoordinator.commitArchiveDelta(scope, delta, options)",
    );
    expect(facadeSource).toContain("this.mutationCoordinator.commitFullScan(");
    expect(facadeSource).not.toContain("private archiveStateQueue");
    expect(facadeSource).not.toContain("private async commitArchiveDelta(");
    expect(facadeSource).not.toContain("private async commitArchiveStateMutation");
    expect(facadeSource).not.toContain("private reconcileProgressOutcome");
    expect(facadeSource).not.toContain('from "./archiveModelReducer"');
    expect(facadeSource).not.toContain('from "./tauri/ProgressMetadataWriteQueue"');
  });

  it("keeps progress coalescing and reconciliation under the commit owner", () => {
    expect(coordinatorSource).toContain("new ProgressMetadataWriteQueue({");
    expect(coordinatorSource).toContain("this.reconcileProgressOutcome(");
    expect(coordinatorSource).toContain("this.progressMetadataWrites.desiredOr(");
    expect(coordinatorSource).toContain("this.progressMetadataWrites.schedule(");
    expect(coordinatorSource).toContain("await this.enqueueCommit(scope, async () => {");
  });

  it("publishes one immutable snapshot only after owned model persistence", () => {
    const persistence = coordinatorSource.indexOf('"save_library_metadata"');
    const modelAssignment = coordinatorSource.indexOf(
      "this.libraryMetadata = next.libraryMetadata",
      persistence,
    );
    const publication = coordinatorSource.indexOf("this.publishLibrarySnapshot({", modelAssignment);

    expect(persistence).toBeGreaterThan(-1);
    expect(modelAssignment).toBeGreaterThan(persistence);
    expect(publication).toBeGreaterThan(modelAssignment);
    expect(coordinatorSource).toContain("const snapshot: LibrarySnapshot = Object.freeze({");
    expect(coordinatorSource).toContain(
      "this.librarySnapshotObservers.forEach((observer) => observer.next(snapshot))",
    );
  });

  it("keeps settings and domain-operation intent outside the coordinator", () => {
    expect(coordinatorSource).not.toContain("save_settings_metadata");
    expect(facadeSource).toContain("private async mutateSettingsMetadata(");
    expect(operationTypesSource).toContain("export interface StorageOperationHost");
    expect(operationTypesSource).toContain("commitArchiveStateMutation<T>");
    expect(operationTypesSource).toContain("applyArchiveDelta(");
    expect(operationTypesSource).toContain("applyScanDelta(");
    expect(coordinatorSource).not.toContain("class BookOperations");
    expect(coordinatorSource).not.toContain("class FolderOperations");
    expect(coordinatorSource).not.toContain("class BulkBookOperations");
    expect(coordinatorSource).not.toContain("class WritebackOperations");
    expect(coordinatorSource).not.toContain("class MaintenanceOperations");
  });
});
