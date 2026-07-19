export type StartupMilestone =
  | "startup"
  | "appearance-runtime"
  | "preferences"
  | "archive"
  | "window"
  | "storage"
  | "scan"
  | "shell"
  | "library-render"
  | "library-usable";

export const STARTUP_TO_SHELL_MEASURE = "archeion:startup-to-shell";
export const STARTUP_TO_USABLE_LIBRARY_MEASURE = "archeion:startup-to-usable-library";

type StartupPerformance = Pick<Performance, "mark" | "measure">;

const milestoneName = (milestone: StartupMilestone) => `archeion:startup:${milestone}`;

export class StartupTrace {
  private readonly milestones = new Set<StartupMilestone>();

  constructor(
    private readonly runtime: StartupPerformance | undefined = globalThis.performance,
    private readonly enabled = import.meta.env.DEV,
  ) {}

  mark(milestone: StartupMilestone): void {
    if (!this.enabled || !this.runtime || this.milestones.has(milestone)) {
      return;
    }

    this.milestones.add(milestone);
    this.runtime.mark(milestoneName(milestone));

    if (!this.milestones.has("startup")) {
      return;
    }

    if (milestone === "shell") {
      this.runtime.measure(
        STARTUP_TO_SHELL_MEASURE,
        milestoneName("startup"),
        milestoneName("shell"),
      );
    }

    if (milestone === "library-usable") {
      this.runtime.measure(
        STARTUP_TO_USABLE_LIBRARY_MEASURE,
        milestoneName("startup"),
        milestoneName("library-usable"),
      );
    }
  }
}

export const startupTrace = new StartupTrace();
