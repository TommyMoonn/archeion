import type { ProgressMetadata } from "../metadataFiles";
import { CoalescedWriteQueue, type CoalescedWriteAttempt } from "../CoalescedWriteQueue";

export type ProgressWriteOutcome = {
  attemptSequence: number;
  changedBookIds: ReadonlySet<string>;
  isSuperseded: () => boolean;
  metadata: Readonly<ProgressMetadata>;
  persistedBaseline: Readonly<ProgressMetadata>;
};

type ProgressMetadataWriteQueueOptions = {
  delayMs: number;
  initialPersistedMetadata: ProgressMetadata;
  onFailedBatch: (outcome: ProgressWriteOutcome) => Promise<void> | void;
  onRetriedBatchPersisted: (outcome: ProgressWriteOutcome) => Promise<void> | void;
  write: (metadata: ProgressMetadata) => Promise<void>;
};

export class ProgressMetadataWriteQueue {
  private lastPersistedMetadata: ProgressMetadata;
  private readonly queue: CoalescedWriteQueue<ProgressMetadata>;

  constructor(options: ProgressMetadataWriteQueueOptions) {
    this.lastPersistedMetadata = structuredClone(options.initialPersistedMetadata);
    this.queue = new CoalescedWriteQueue({
      delayMs: options.delayMs,
      write: options.write,
      onFailure: async (attempt) => {
        await options.onFailedBatch(this.createOutcome(attempt));
      },
      onSuccess: async (attempt) => {
        const outcome = this.createOutcome(attempt);
        this.lastPersistedMetadata = structuredClone(attempt.value);
        if (attempt.kind === "retry") {
          await options.onRetriedBatchPersisted(outcome);
        }
      },
    });
  }

  desiredOr(metadata: Readonly<ProgressMetadata>): Readonly<ProgressMetadata> {
    return this.queue.getLatestValue() ?? metadata;
  }

  schedule(metadata: ProgressMetadata): Promise<void> {
    return this.queue.schedule(metadata);
  }

  flush(): Promise<void> {
    return this.queue.flush();
  }

  replacePersistedMetadata(metadata: Readonly<ProgressMetadata>): void {
    this.lastPersistedMetadata = structuredClone(metadata);
  }

  private createOutcome(attempt: CoalescedWriteAttempt<ProgressMetadata>): ProgressWriteOutcome {
    return {
      attemptSequence: attempt.sequence,
      changedBookIds: changedProgressBookIds(this.lastPersistedMetadata, attempt.value),
      isSuperseded: attempt.isSuperseded,
      metadata: structuredClone(attempt.value),
      persistedBaseline: structuredClone(this.lastPersistedMetadata),
    };
  }
}

function changedProgressBookIds(
  baseline: Readonly<ProgressMetadata>,
  desired: Readonly<ProgressMetadata>,
): ReadonlySet<string> {
  const ids = new Set([...Object.keys(baseline.progress), ...Object.keys(desired.progress)]);
  return new Set(
    [...ids].filter((id) => {
      const previous = baseline.progress[id];
      const next = desired.progress[id];
      return (
        previous?.cfi !== next?.cfi ||
        previous?.percent !== next?.percent ||
        previous?.lastOpenedAt !== next?.lastOpenedAt
      );
    }),
  );
}
