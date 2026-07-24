import { describe, expect, it, vi } from "vitest";

import {
  STARTUP_TO_LIBRARY_SNAPSHOT_MEASURE,
  STARTUP_TO_SHELL_MEASURE,
  STARTUP_TO_USABLE_LIBRARY_MEASURE,
  StartupTrace,
} from "./startupTrace";

describe("startup trace", () => {
  it("retains one mark per critical-path milestone and terminal measurements", () => {
    const mark = vi.fn();
    const measure = vi.fn();
    const trace = new StartupTrace({ mark, measure }, true);

    trace.mark("startup");
    trace.mark("preferences");
    trace.mark("archive");
    trace.mark("shell");
    trace.mark("shell");
    trace.mark("library-render");
    trace.mark("library-snapshot");
    trace.mark("library-snapshot");
    trace.mark("library-usable");

    expect(mark.mock.calls.map(([name]) => name)).toEqual([
      "archeion:startup:startup",
      "archeion:startup:preferences",
      "archeion:startup:archive",
      "archeion:startup:shell",
      "archeion:startup:library-render",
      "archeion:startup:library-snapshot",
      "archeion:startup:library-usable",
    ]);
    expect(measure).toHaveBeenCalledWith(
      STARTUP_TO_SHELL_MEASURE,
      "archeion:startup:startup",
      "archeion:startup:shell",
    );
    expect(measure).toHaveBeenCalledWith(
      STARTUP_TO_LIBRARY_SNAPSHOT_MEASURE,
      "archeion:startup:startup",
      "archeion:startup:library-snapshot",
    );
    expect(measure).toHaveBeenCalledWith(
      STARTUP_TO_USABLE_LIBRARY_MEASURE,
      "archeion:startup:startup",
      "archeion:startup:library-usable",
    );
  });

  it("does not publish development timing entries when tracing is disabled", () => {
    const mark = vi.fn();
    const measure = vi.fn();
    const trace = new StartupTrace({ mark, measure }, false);

    trace.mark("startup");
    trace.mark("shell");

    expect(mark).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });
});
