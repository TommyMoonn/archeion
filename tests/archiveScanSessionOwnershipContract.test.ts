import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(path, "utf8");

describe("Phase 0.9.0.19 archive scan-session ownership", () => {
  const ownerSource = readSource("src/storage/archiveScanSession.ts");
  const storageSource = readSource("src/storage/TauriArchiveLibraryStorage.ts");
  const bulkOperationsSource = readSource("src/storage/tauri/bulkBookOperations.ts");
  const maintenanceSource = readSource("src/storage/tauri/maintenanceOperations.ts");
  const startupSource = readSource("src/features/archive/ArchiveGate.tsx");

  it("keeps full and targeted scan commands inside the scan-session owner", () => {
    expect(ownerSource).toContain('"scan_archive"');
    expect(ownerSource).toContain('"scan_archive_epub_paths"');
    expect(storageSource).not.toMatch(/commands\.invoke\(\s*"scan_archive(?:_epub_paths)?"/);
    expect(bulkOperationsSource).not.toMatch(/commands\.invoke\(\s*"scan_archive(?:_epub_paths)?"/);
  });

  it("routes facade, startup, maintenance, watcher, import, and bulk entry points through it", () => {
    expect(storageSource).toContain("return this.scanSession.rescan(options)");
    expect(storageSource.match(/this\.scanSession\.runTargetedScan/g)).toHaveLength(3);
    expect(storageSource).toContain("this.scanSession.runReplacementFullScan");
    expect(bulkOperationsSource).toContain("this.host.runTargetedScan");
    expect(maintenanceSource).toContain("this.host.rescan({ followUpIfRunning: true })");
    expect(startupSource).toContain("storage.rescan()");
  });

  it("does not retain scan-session flags or sequencing methods in the storage facade", () => {
    expect(storageSource).not.toMatch(
      /scanPromise|followUpScanQueued|scanStatusVisible|scanStatusStartedAt/,
    );
    expect(storageSource).not.toMatch(/performQueuedScans|showActiveScanStatus|performScan\s*\(/);
  });
});
