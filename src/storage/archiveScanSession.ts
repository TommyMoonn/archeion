import type { RescanOptions, ScanStatus } from "./LibraryStorage";
import type { ArchiveEpubScan, ArchiveScan } from "./reconcileLibraryState";
import type { ArchiveCommandClient } from "./tauri/archiveCommandClient";
import type { ArchiveCommandScope } from "./tauri/operationTypes";

type FullScanCompletion = Readonly<{
  settleStatusForPublication: () => void;
}>;

type ArchiveScanSessionHost = Readonly<{
  commands: ArchiveCommandClient;
  createScope: () => ArchiveCommandScope;
  isCurrentScope: (scope: ArchiveCommandScope) => boolean;
  applyFullScan: (
    scope: ArchiveCommandScope,
    scan: ArchiveScan,
    replacementRelativePaths: readonly string[],
    completion: FullScanCompletion,
  ) => Promise<boolean>;
  publishFullScanFailure: (scope: ArchiveCommandScope) => void;
  publishStatusChange: (loadState?: "loading") => void;
}>;

type FullScanSession = {
  epoch: number;
  followUpQueued: boolean;
  promise: Promise<void>;
  scope: ArchiveCommandScope;
  startedAt: string;
  visible: boolean;
};

type ScanQueueLane = {
  busy: boolean;
  pending: Array<() => void>;
  tail: Promise<void>;
};

type TargetedScanRequest<T> = Readonly<{
  apply: (scan: ArchiveEpubScan) => Promise<T>;
  followUpFullScanIfRunning?: boolean;
  prepare?: () => Promise<void>;
  relativePaths: readonly string[];
  scope: ArchiveCommandScope;
}>;

export class ArchiveScanCommandError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error && cause.message ? cause.message : "The archive scan command failed.",
      { cause },
    );
    this.name = "ArchiveScanCommandError";
  }
}

export function isArchiveScanCommandError(error: unknown): error is ArchiveScanCommandError {
  return error instanceof ArchiveScanCommandError;
}

export class ArchiveScanSession {
  private epoch = 0;
  private fullSession: FullScanSession | null = null;
  private queueLane: ScanQueueLane = this.createQueueLane();
  private scanStatus: ScanStatus = { status: "idle" };

  constructor(private readonly host: ArchiveScanSessionHost) {}

  get status(): ScanStatus {
    return this.scanStatus;
  }

  reset(): void {
    this.epoch += 1;
    this.fullSession = null;
    this.queueLane = this.createQueueLane();
    this.scanStatus = { status: "idle" };
  }

  rescan(options?: RescanOptions): Promise<void> {
    const shouldReportStatus = options?.quiet !== true;
    const active = this.fullSession;
    if (active?.epoch === this.epoch) {
      if (options?.followUpIfRunning) {
        active.followUpQueued = true;
      }
      if (shouldReportStatus) {
        this.showStatus(active);
      }
      return active.promise;
    }

    const scope = this.host.createScope();
    const session: FullScanSession = {
      epoch: this.epoch,
      followUpQueued: false,
      promise: Promise.resolve(),
      scope,
      startedAt: new Date().toISOString(),
      visible: shouldReportStatus,
    };
    if (shouldReportStatus) {
      this.scanStatus = { status: "scanning", startedAt: session.startedAt };
      this.host.publishStatusChange("loading");
    }

    const promise = this.enqueue(session.epoch, () => this.runFullSession(session));
    session.promise = promise;
    this.fullSession = session;
    void promise.then(
      () => this.retireFullSession(session),
      () => this.retireFullSession(session),
    );
    return promise;
  }

  runReplacementFullScan(
    scope: ArchiveCommandScope,
    replacementRelativePaths: readonly string[],
  ): Promise<boolean | undefined> {
    const epoch = this.epoch;
    return this.enqueue(epoch, () =>
      this.runFullScan(scope, replacementRelativePaths, {
        settleStatusForPublication: () => undefined,
      }),
    );
  }

  runFallbackFullScan(
    scope: ArchiveCommandScope,
    replacementRelativePaths: readonly string[] = [],
  ): Promise<boolean | undefined> {
    return this.runFullScan(scope, replacementRelativePaths, {
      settleStatusForPublication: () => undefined,
    }).catch((error: unknown) => {
      if (!this.host.isCurrentScope(scope)) return undefined;
      this.host.publishFullScanFailure(scope);
      throw error;
    });
  }

  async runTargetedScan<T>(request: TargetedScanRequest<T>): Promise<T | undefined> {
    const active = this.fullSession;
    if (
      request.followUpFullScanIfRunning &&
      active?.epoch === this.epoch &&
      this.host.isCurrentScope(request.scope)
    ) {
      await this.rescan({ followUpIfRunning: true, quiet: true });
      return undefined;
    }

    const epoch = this.epoch;
    return this.enqueue(epoch, async () => {
      if (!this.isCurrent(epoch, request.scope)) return undefined;
      await request.prepare?.();
      if (!this.isCurrent(epoch, request.scope)) return undefined;

      let scan: ArchiveEpubScan;
      try {
        scan = await this.host.commands.invoke(
          "scan_archive_epub_paths",
          { relativePaths: [...request.relativePaths] },
          request.scope.rootPath,
        );
      } catch (error) {
        if (!this.isCurrent(epoch, request.scope)) return undefined;
        throw new ArchiveScanCommandError(error);
      }

      if (!this.isCurrent(epoch, request.scope)) return undefined;
      return request.apply(scan);
    });
  }

  async waitForCurrentWork(scope: ArchiveCommandScope): Promise<void> {
    const pending = this.queueLane.tail;
    await pending.catch(() => undefined);
    if (!this.host.isCurrentScope(scope)) {
      return;
    }
  }

  private enqueue<T>(epoch: number, operation: () => Promise<T>): Promise<T | undefined> {
    const lane = this.queueLane;
    let start!: () => void;
    const pending = new Promise<T | undefined>((resolve, reject) => {
      start = () => {
        const finish = () => {
          const next = lane.pending.shift();
          if (next) {
            next();
          } else {
            lane.busy = false;
          }
        };

        if (epoch !== this.epoch) {
          finish();
          resolve(undefined);
          return;
        }

        let result: Promise<T>;
        try {
          result = operation();
        } catch (error) {
          finish();
          reject(error);
          return;
        }
        void result.then(
          (value) => {
            finish();
            resolve(value);
          },
          (error: unknown) => {
            finish();
            reject(error);
          },
        );
      };
    });
    lane.tail = pending.then(
      () => undefined,
      () => undefined,
    );
    if (lane.busy) {
      lane.pending.push(start);
    } else {
      lane.busy = true;
      start();
    }
    return pending;
  }

  private createQueueLane(): ScanQueueLane {
    return {
      busy: false,
      pending: [],
      tail: Promise.resolve(),
    };
  }

  private async runFullSession(session: FullScanSession): Promise<void> {
    try {
      do {
        session.followUpQueued = false;
        await this.runFullScan(session.scope, [], {
          settleStatusForPublication: () => this.settleStatusForPublication(session),
        });
      } while (this.isCurrent(session.epoch, session.scope) && session.followUpQueued);
    } catch (error) {
      if (!this.isCurrent(session.epoch, session.scope)) return;
      this.host.publishFullScanFailure(session.scope);
      throw error;
    }
  }

  private async runFullScan(
    scope: ArchiveCommandScope,
    replacementRelativePaths: readonly string[],
    completion: FullScanCompletion,
  ): Promise<boolean | undefined> {
    const epoch = this.epoch;
    if (!this.isCurrent(epoch, scope)) return undefined;
    const scan = await this.host.commands.invoke("scan_archive", undefined, scope.rootPath);
    if (!this.isCurrent(epoch, scope)) return undefined;
    return this.host.applyFullScan(scope, scan, replacementRelativePaths, completion);
  }

  private settleStatusForPublication(session: FullScanSession): void {
    if (
      this.fullSession !== session ||
      !this.isCurrent(session.epoch, session.scope) ||
      !session.visible ||
      session.followUpQueued
    ) {
      return;
    }
    session.visible = false;
    this.scanStatus = { status: "idle" };
  }

  private retireFullSession(session: FullScanSession): void {
    if (this.fullSession !== session || session.epoch !== this.epoch) return;
    this.fullSession = null;
    if (session.visible) {
      session.visible = false;
      this.scanStatus = { status: "idle" };
      this.host.publishStatusChange();
    }
  }

  private showStatus(session: FullScanSession): void {
    if (session.visible) return;
    session.visible = true;
    this.scanStatus = { status: "scanning", startedAt: session.startedAt };
    this.host.publishStatusChange("loading");
  }

  private isCurrent(epoch: number, scope: ArchiveCommandScope): boolean {
    return epoch === this.epoch && this.host.isCurrentScope(scope);
  }
}
