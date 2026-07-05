export class DebouncedTask<T> {
  private hasPending = false;
  private pending: T | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly run: (value: T) => void,
  ) {}

  schedule(value: T) {
    this.pending = value;
    this.hasPending = true;
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = globalThis.setTimeout(() => this.flush(), this.delayMs);
  }

  flush() {
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.hasPending) return;
    const pending = this.pending as T;
    this.hasPending = false;
    this.pending = undefined;
    this.run(pending);
  }
}
