type PendingResolver = {
  reject: (error: unknown) => void;
  resolve: () => void;
};

export type CoalescedWriteAttempt<T> = {
  kind: "scheduled" | "retry";
  sequence: number;
  value: T;
  isSuperseded: () => boolean;
};

type PendingBatch<T> = {
  kind: "scheduled" | "retry";
  ready: boolean;
  resolvers: PendingResolver[];
  sequence: number;
  value: T;
};

type FailedValue<T> = {
  sequence: number;
  value: T;
};

type BatchResult<T> =
  | {
      attempt: CoalescedWriteAttempt<T>;
      status: "success";
    }
  | {
      attempt: CoalescedWriteAttempt<T>;
      error: unknown;
      status: "physical-failure";
    }
  | {
      attempt: CoalescedWriteAttempt<T>;
      callback: "failure";
      error: unknown;
      physicalError: unknown;
      status: "callback-failure";
    }
  | {
      attempt: CoalescedWriteAttempt<T>;
      callback: "success";
      error: unknown;
      status: "callback-failure";
    };

type CoalescedWriteQueueOptions<T> = {
  delayMs: number;
  onFailure?: (attempt: CoalescedWriteAttempt<T>, error: unknown) => Promise<void> | void;
  onSuccess?: (attempt: CoalescedWriteAttempt<T>) => Promise<void> | void;
  write: (value: T) => Promise<void>;
};

/**
 * Owns one trailing write stream. Pending logical writes share the latest full value,
 * while physical writes remain serialized and explicit flushes retry the last failed value once.
 */
export class CoalescedWriteQueue<T> {
  private failedValue: FailedValue<T> | null = null;
  private flushInProgress = false;
  private flushPromise: Promise<void> | null = null;
  private inFlight: Promise<BatchResult<T>> | null = null;
  private latestSequence = 0;
  private latestValue: T | null = null;
  private pending: PendingBatch<T> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: CoalescedWriteQueueOptions<T>) {}

  schedule(value: T, mode: "immediate" | "trailing" = "trailing"): Promise<void> {
    this.failedValue = null;
    this.latestSequence += 1;
    this.latestValue = value;
    const sequence = this.latestSequence;
    const promise = new Promise<void>((resolve, reject) => {
      if (this.pending) {
        this.pending.kind = "scheduled";
        this.pending.sequence = sequence;
        this.pending.value = value;
        this.pending.resolvers.push({ reject, resolve });
      } else {
        this.pending = {
          kind: "scheduled",
          ready: mode === "immediate",
          resolvers: [{ reject, resolve }],
          sequence,
          value,
        };
      }
    });

    if (mode === "immediate") {
      this.markPendingReady();
    } else {
      this.scheduleTimer();
    }
    this.startReadyWrite();
    return promise;
  }

  flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;

    this.flushInProgress = true;
    const flush = Promise.resolve().then(() => this.runFlush());
    this.flushPromise = flush;
    return flush;
  }

  getLatestValue(): T | null {
    return this.latestValue;
  }

  private async runFlush(): Promise<void> {
    let drainError: unknown;
    let hasDrainError = false;
    const retryBlockedSequences = new Set<number>();

    const recordDrainError = (error: unknown): void => {
      if (hasDrainError) return;
      hasDrainError = true;
      drainError = error;
    };

    try {
      this.clearTimer();
      if (this.pending) this.pending.ready = true;

      while (true) {
        if (this.inFlight) {
          const result = await this.inFlight;
          if (result.status === "callback-failure") {
            recordDrainError(result.error);
            if (result.callback === "failure") {
              retryBlockedSequences.add(result.attempt.sequence);
            }
          }
          if (
            result.status === "physical-failure" &&
            result.attempt.kind === "retry" &&
            !result.attempt.isSuperseded()
          ) {
            recordDrainError(result.error);
            retryBlockedSequences.add(result.attempt.sequence);
          }
          continue;
        }

        if (this.pending) {
          this.clearTimer();
          this.pending.ready = true;
          this.startReadyWrite();
          continue;
        }

        if (this.failedValue && !retryBlockedSequences.has(this.failedValue.sequence)) {
          this.materializeRetry();
          this.startReadyWrite();
          continue;
        }

        if (hasDrainError) throw drainError;
        return;
      }
    } finally {
      this.flushPromise = null;
      this.flushInProgress = false;
    }
  }

  private materializeRetry(): void {
    if (!this.failedValue || this.pending) return;
    this.pending = {
      kind: "retry",
      ready: true,
      resolvers: [],
      sequence: this.failedValue.sequence,
      value: this.failedValue.value,
    };
    this.latestValue = this.failedValue.value;
    this.failedValue = null;
  }

  private scheduleTimer(): void {
    this.clearTimer();
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      if (this.pending) this.pending.ready = true;
      this.startReadyWrite();
    }, this.options.delayMs);
  }

  private markPendingReady(): void {
    this.clearTimer();
    if (this.pending) this.pending.ready = true;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private startReadyWrite(): void {
    if (this.inFlight || !this.pending?.ready) return;

    const batch = this.pending;
    this.pending = null;
    const completion = this.executeBatch(batch);
    const tracked = completion.finally(() => {
      if (this.inFlight === tracked) this.inFlight = null;
      if (!this.flushInProgress && this.pending?.ready) this.startReadyWrite();
    });
    this.inFlight = tracked;
  }

  private async executeBatch(batch: PendingBatch<T>): Promise<BatchResult<T>> {
    const attempt = this.createAttempt(batch);

    try {
      await this.options.write(batch.value);
    } catch (error) {
      if (!attempt.isSuperseded()) {
        this.failedValue = { sequence: batch.sequence, value: batch.value };
      }
      try {
        await this.options.onFailure?.(attempt, error);
      } catch (callbackError) {
        batch.resolvers.forEach(({ reject }) => reject(error));
        return {
          attempt,
          callback: "failure",
          error: callbackError,
          physicalError: error,
          status: "callback-failure",
        };
      }
      if (!attempt.isSuperseded()) {
        this.latestValue = null;
      }
      batch.resolvers.forEach(({ reject }) => reject(error));
      return { attempt, error, status: "physical-failure" };
    }

    try {
      await this.options.onSuccess?.(attempt);
    } catch (error) {
      batch.resolvers.forEach(({ reject }) => reject(error));
      return { attempt, callback: "success", error, status: "callback-failure" };
    }

    if (!attempt.isSuperseded() && !this.pending) {
      this.latestValue = null;
    }
    batch.resolvers.forEach(({ resolve }) => resolve());
    return { attempt, status: "success" };
  }

  private createAttempt(batch: PendingBatch<T>): CoalescedWriteAttempt<T> {
    return {
      kind: batch.kind,
      sequence: batch.sequence,
      value: batch.value,
      isSuperseded: () => this.latestSequence > batch.sequence,
    };
  }
}
